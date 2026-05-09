import { existsSync } from "fs";
import { mkdir, readdir, writeFile } from "fs/promises";
import { basename, join, relative, resolve } from "path";
import { Connection } from "../connection/Connection.js";
import { Schema } from "../schema/Schema.js";
import { Blueprint } from "../schema/Blueprint.js";
import { Builder } from "../query/Builder.js";
import { TypeGenerator } from "../typegen/TypeGenerator.js";
import type { TypeGeneratorOptions } from "../typegen/TypeGenerator.js";
import type { Migration } from "./Migration.js";
import { normalizePathList, toPosixPath } from "../utils.js";

interface MigrationRecord {
  id: number;
  migration: string;
  batch: number;
}

export type MigrationEvent =
  | "migrating"
  | "migrated"
  | "rollingBack"
  | "rolledBack"
  | "schemaDumped"
  | "schemaSquashed";

export interface MigrationEventPayload {
  migration?: string;
  batch?: number;
  path?: string;
}

export type MigrationEventListener = (payload: MigrationEventPayload) => void | Promise<void>;

export class Migrator {
  private static listeners = new Map<MigrationEvent, Set<MigrationEventListener>>();

  constructor(
    private connection: Connection,
    private path: string | string[],
    private typesOutDir?: string,
    private typeGeneratorOptions: Omit<TypeGeneratorOptions, "outDir"> = {}
  ) {
    Schema.setConnection(connection);
  }

  private getPaths(): string[] {
    return normalizePathList(this.path);
  }

  private async ensureMigrationsTable(): Promise<void> {
    const exists = await Schema.hasTable("migrations");
    if (!exists) {
      await Schema.create("migrations", (table: Blueprint) => {
        table.increments("id");
        table.string("migration");
        table.integer("batch");
      });
    }
  }

  static on(event: MigrationEvent, listener: MigrationEventListener): () => void {
    const listeners = this.listeners.get(event) || new Set<MigrationEventListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  static clearListeners(event?: MigrationEvent): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }

  private async emit(event: MigrationEvent, payload: MigrationEventPayload): Promise<void> {
    for (const listener of Migrator.listeners.get(event) || []) {
      await listener(payload);
    }
  }

  private async getLastBatchNumber(): Promise<number> {
    const result = await new Builder(this.connection, "migrations")
      .select("MAX(batch) as batch")
      .first();
    return (result as any)?.batch || 0;
  }

  private async getMigrationFiles(): Promise<{ id: string; fileName: string; fullPath: string }[]> {
    const files: { id: string; fileName: string; fullPath: string }[] = [];

    for (const path of this.getPaths()) {
      if (!existsSync(path)) continue;
      const entries = await readdir(path);
      for (const fileName of entries) {
        if (!fileName.endsWith(".ts") && !fileName.endsWith(".js")) continue;
        const fullPath = resolve(path, fileName);
        files.push({
          id: toPosixPath(relative(process.cwd(), fullPath)),
          fileName,
          fullPath,
        });
      }
    }

    return files.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.id.localeCompare(b.id));
  }

  async run(): Promise<void> {
    const ran = await this.getRan();
    const files = await this.getMigrationFiles();
    const pending = files.filter((f) => !ran.has(f.id) && !ran.has(f.fileName));

    if (pending.length === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    const batch = (await this.getLastBatchNumber()) + 1;

    await this.connection.beginTransaction();
    try {
      for (const file of pending) {
        const migration = await this.resolve(file.id);
        console.log(`Migrating: ${file.id}`);
        await this.emit("migrating", { migration: file.id, batch });
        await migration.up();
        await new Builder(this.connection, "migrations").insert({
          migration: file.id,
          batch,
        });
        await this.emit("migrated", { migration: file.id, batch });
        console.log(`Migrated:  ${file.id}`);
      }
      await this.connection.commit();
      await this.generateTypesIfNeeded();
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  async rollback(): Promise<void> {
    const batch = await this.getLastBatchNumber();
    if (batch === 0) {
      console.log("Nothing to rollback.");
      return;
    }

    const records = (await new Builder(this.connection, "migrations")
      .where("batch", batch)
      .orderBy("id", "desc")
      .get()) as MigrationRecord[];

    if (records.length === 0) {
      console.log("Nothing to rollback.");
      return;
    }

    await this.connection.beginTransaction();
    try {
      for (const record of records) {
        const migration = await this.resolve(record.migration);
        console.log(`Rolling back: ${record.migration}`);
        await this.emit("rollingBack", { migration: record.migration, batch });
        await migration.down();
        await new Builder(this.connection, "migrations")
          .where("id", record.id)
          .delete();
        await this.emit("rolledBack", { migration: record.migration, batch });
        console.log(`Rolled back:  ${record.migration}`);
      }
      await this.connection.commit();
      await this.generateTypesIfNeeded();
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  private async generateTypesIfNeeded(): Promise<void> {
    const modelDirectories = normalizePathList(this.typeGeneratorOptions.modelDirectories || this.typeGeneratorOptions.modelDirectory);
    if (!this.typesOutDir && modelDirectories.length === 0) return;

    const outDir = this.typesOutDir || join(modelDirectories[0], this.typeGeneratorOptions.declarationDirName || "types");
    const generator = new TypeGenerator(this.connection, {
      declarations: true,
      ...this.typeGeneratorOptions,
      outDir,
    });
    await generator.generate();
    const label = this.typesOutDir || modelDirectories.map((dir) => join(dir, this.typeGeneratorOptions.declarationDirName || "types")).join(", ");
    console.log(`Regenerated types in ${label}`);
  }

  async status(): Promise<{ migration: string; status: string }[]> {
    const ran = await this.getRan();
    const files = await this.getMigrationFiles();
    return files.map((file) => ({
      migration: file.id,
      status: ran.has(file.id) || ran.has(file.fileName) ? "Ran" : "Pending",
    }));
  }

  async dumpSchema(path: string): Promise<string> {
    const sql = await this.getSchemaDumpSql();
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, sql, "utf-8");
    await this.emit("schemaDumped", { path });
    return sql;
  }

  async squash(path: string): Promise<string> {
    const sql = await this.dumpSchema(path);
    const files = await this.getMigrationFiles();
    await this.ensureMigrationsTable();
    const batch = (await this.getLastBatchNumber()) + 1;

    await new Builder(this.connection, "migrations").delete();
    for (const file of files) {
      await new Builder(this.connection, "migrations").insert({
        migration: file.id,
        batch,
      });
    }

    await this.emit("schemaSquashed", { path, batch });
    return sql;
  }

  private async getSchemaDumpSql(): Promise<string> {
    const driver = this.connection.getDriverName();
    if (driver === "sqlite") {
      const rows = await this.connection.query(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'index', 'trigger', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC, name"
      );
      return rows.map((row: any) => `${String(row.sql).trim()};`).join("\n\n") + "\n";
    }

    if (driver === "mysql") {
      const tables = await this.connection.query("SHOW TABLES");
      const key = Object.keys(tables[0] ?? {})[0];
      const statements: string[] = [];
      for (const row of tables as any[]) {
        const table = row[key];
        const createRows = await this.connection.query(`SHOW CREATE TABLE ${table}`);
        statements.push(`${createRows[0]["Create Table"]};`);
      }
      return statements.join("\n\n") + "\n";
    }

    const schema = this.connection.getSchema() || "public";
    const tables = await this.connection.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    const statements: string[] = [];

    for (const tableRow of tables as any[]) {
      const table = tableRow.table_name;
      const columns = await this.connection.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema = '${schema}' AND table_name = '${table}'
         ORDER BY ordinal_position`
      );
      const primaryKeys = await this.connection.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = '${schema}'
           AND tc.table_name = '${table}'
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY kcu.ordinal_position`
      );
      const pkColumns = primaryKeys.map((row: any) => row.column_name);
      const columnSql = columns.map((column: any) => {
        let type = String(column.data_type).toUpperCase();
        if ((type === "CHARACTER VARYING" || type === "CHARACTER") && column.character_maximum_length) {
          type = `${type}(${column.character_maximum_length})`;
        } else if ((type === "NUMERIC" || type === "DECIMAL") && column.numeric_precision) {
          type = `${type}(${column.numeric_precision}${column.numeric_scale ? `, ${column.numeric_scale}` : ""})`;
        }

        let sql = `  "${column.column_name}" ${type}`;
        if (column.is_nullable === "NO") sql += " NOT NULL";
        if (column.column_default !== null && column.column_default !== undefined) sql += ` DEFAULT ${column.column_default}`;
        return sql;
      });
      if (pkColumns.length > 0) {
        columnSql.push(`  PRIMARY KEY (${pkColumns.map((column: string) => `"${column}"`).join(", ")})`);
      }
      statements.push(`CREATE TABLE "${schema}"."${table}" (\n${columnSql.join(",\n")}\n);`);
    }

    return statements.join("\n\n") + "\n";
  }

  private async resolve(file: string): Promise<Migration> {
    const normalized = toPosixPath(file);
    const candidates = new Set<string>();

    if (normalized.includes("/")) {
      candidates.add(resolve(process.cwd(), normalized));
    } else {
      for (const path of this.getPaths()) {
        candidates.add(resolve(path, normalized));
      }
    }

    const matches = [...candidates].filter((candidate) => existsSync(candidate));
    if (matches.length === 0) {
      throw new Error(`Migration ${file} could not be found in the configured migration paths.`);
    }
    if (matches.length > 1) {
      throw new Error(`Migration ${file} is ambiguous across multiple migration paths.`);
    }

    const module = await import(matches[0]);
    const MigrationClass = module.default || Object.values(module)[0];
    if (!MigrationClass) {
      throw new Error(`Migration ${file} does not export a class.`);
    }
    return new MigrationClass();
  }

  private async getRan(): Promise<Set<string>> {
    await this.ensureMigrationsTable();
    const results = await new Builder(this.connection, "migrations")
      .orderBy("id", "asc")
      .get();

    const ran = new Set<string>();
    for (const row of results as any[]) {
      const migration = toPosixPath(String(row.migration));
      ran.add(migration);
      ran.add(basename(migration));
    }
    return ran;
  }
}
