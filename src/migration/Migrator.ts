import { createHash } from "node:crypto";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
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
  tenant?: string | null;
  checksum?: string | null;
}

export interface MigrationStatusRow {
  migration: string;
  status: string;
  tenant: string | null;
  checksum?: string;
  storedChecksum?: string | null;
}

export interface MigratorOptions {
  tenantId?: string | null;
  lock?: boolean;
  lockTimeoutMs?: number;
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
    private typeGeneratorOptions: Omit<TypeGeneratorOptions, "outDir"> = {},
    private options: MigratorOptions = {}
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
        table.string("tenant").nullable().index();
        table.string("checksum").nullable();
        table.integer("batch");
      });
      return;
    }

    if (!(await Schema.hasColumn("migrations", "tenant"))) {
      await Schema.table("migrations", (table: Blueprint) => {
        table.string("tenant").nullable().index();
      });
    }
    if (!(await Schema.hasColumn("migrations", "checksum"))) {
      await Schema.table("migrations", (table: Blueprint) => {
        table.string("checksum").nullable();
      });
    }
  }

  private getTenantId(): string | null {
    return this.options.tenantId ?? null;
  }

  private scopedMigrations(): Builder<any> {
    const builder = new Builder<any>(this.connection, "migrations");
    const tenantId = this.getTenantId();
    return tenantId === null ? builder.whereNull("tenant") : builder.where("tenant", tenantId);
  }

  private async ensureMigrationLocksTable(): Promise<void> {
    if (await Schema.hasTable("migration_locks")) return;
    await Schema.create("migration_locks", (table: Blueprint) => {
      table.string("name").primary();
      table.string("owner");
      table.string("created_at");
    });
  }

  private getLockName(): string {
    const tenantId = this.getTenantId();
    return tenantId === null ? "migrations:default" : `migrations:tenant:${tenantId}`;
  }

  private shouldLock(): boolean {
    return this.options.lock !== false;
  }

  private async acquireLock(): Promise<boolean> {
    if (!this.shouldLock()) return false;
    await this.ensureMigrationLocksTable();
    const lockName = this.getLockName();
    const timeoutMs = this.options.lockTimeoutMs ?? 30000;
    const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const started = Date.now();

    while (true) {
      try {
        await new Builder(this.connection, "migration_locks").insert({
          name: lockName,
          owner,
          created_at: new Date().toISOString(),
        });
        return true;
      } catch {
        if (Date.now() - started >= timeoutMs) {
          throw new Error(`Could not acquire migration lock "${lockName}" within ${timeoutMs}ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  private async releaseLock(): Promise<void> {
    if (!this.shouldLock()) return;
    await new Builder(this.connection, "migration_locks")
      .where("name", this.getLockName())
      .delete();
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
    await this.ensureMigrationsTable();
    const result = await this.scopedMigrations()
      .select("MAX(batch) as batch")
      .first();
    return (result as any)?.batch || 0;
  }

  private async getMigrationFiles(): Promise<{ id: string; fileName: string; fullPath: string; checksum: string }[]> {
    const files: { id: string; fileName: string; fullPath: string; checksum: string }[] = [];

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
          checksum: await this.checksumFile(fullPath),
        });
      }
    }

    return files.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.id.localeCompare(b.id));
  }

  private async checksumFile(path: string): Promise<string> {
    const contents = await readFile(path);
    return createHash("sha256").update(contents).digest("hex");
  }

  async run(): Promise<void> {
    await this.ensureMigrationsTable();
    const locked = await this.acquireLock();
    try {
      const ran = await this.getRan();
      const files = await this.getMigrationFiles();
      const pending = files.filter((f) => !ran.has(f.id) && !ran.has(f.fileName));

      if (pending.length === 0) {
        console.log("Nothing to migrate.");
        return;
      }

      const batch = (await this.getLastBatchNumber()) + 1;

      await this.connection.beginTransaction();
      for (const file of pending) {
        const migration = await this.resolve(file.id);
        console.log(`Migrating: ${file.id}`);
        await this.emit("migrating", { migration: file.id, batch });
        await migration.up();
        await new Builder(this.connection, "migrations").insert({
          migration: file.id,
          tenant: this.getTenantId(),
          checksum: file.checksum,
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
    } finally {
      if (locked) await this.releaseLock();
    }
  }

  async rollback(steps: number = 1): Promise<void> {
    await this.ensureMigrationsTable();
    const locked = await this.acquireLock();
    try {
      const batches = await this.getRollbackBatches(steps);
      if (batches.length === 0) {
        console.log("Nothing to rollback.");
        return;
      }

      const records = (await this.scopedMigrations()
        .whereIn("batch", batches)
        .orderBy("id", "desc")
        .get()) as MigrationRecord[];

      if (records.length === 0) {
        console.log("Nothing to rollback.");
        return;
      }

      await this.connection.beginTransaction();
      for (const record of records) {
        const migration = await this.resolve(record.migration);
        console.log(`Rolling back: ${record.migration}`);
        await this.emit("rollingBack", { migration: record.migration, batch: record.batch });
        await migration.down();
        await new Builder(this.connection, "migrations")
          .where("id", record.id)
          .delete();
        await this.emit("rolledBack", { migration: record.migration, batch: record.batch });
        console.log(`Rolled back:  ${record.migration}`);
      }
      await this.connection.commit();
      await this.generateTypesIfNeeded();
    } catch (error) {
      await this.connection.rollback();
      throw error;
    } finally {
      if (locked) await this.releaseLock();
    }
  }

  private async getRollbackBatches(steps: number): Promise<number[]> {
    await this.ensureMigrationsTable();
    const rows = await this.scopedMigrations()
      .select("batch")
      .orderBy("batch", "desc")
      .get();
    const batches: number[] = [];
    for (const row of rows as any[]) {
      const batch = Number(row.batch);
      if (!Number.isFinite(batch) || batches.includes(batch)) continue;
      batches.push(batch);
      if (batches.length >= steps) break;
    }
    return batches;
  }

  async reset(): Promise<void> {
    while ((await this.getLastBatchNumber()) > 0) {
      await this.rollback();
    }
  }

  async refresh(): Promise<void> {
    await this.reset();
    await this.run();
  }

  async fresh(): Promise<void> {
    await this.dropAllTables();
    await this.run();
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

  async status(): Promise<MigrationStatusRow[]> {
    await this.ensureMigrationsTable();
    const ran = await this.getRanRecords();
    const files = await this.getMigrationFiles();
    const tenant = this.getTenantId();
    return files.map((file) => {
      const record = ran.get(file.id) || ran.get(file.fileName);
      const storedChecksum = record?.checksum ?? null;
      return {
        migration: file.id,
        status: !record ? "Pending" : storedChecksum && storedChecksum !== file.checksum ? "Changed" : "Ran",
        tenant,
        checksum: file.checksum,
        storedChecksum,
      };
    });
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

    const locked = await this.acquireLock();
    try {
      await this.scopedMigrations().delete();
      for (const file of files) {
        await new Builder(this.connection, "migrations").insert({
          migration: file.id,
          tenant: this.getTenantId(),
          checksum: file.checksum,
          batch,
        });
      }
    } finally {
      if (locked) await this.releaseLock();
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
        const createRows = await this.connection.query(`SHOW CREATE TABLE ${this.connection.getGrammar().wrap(table)}`);
        statements.push(`${createRows[0]["Create Table"]};`);
      }
      return statements.join("\n\n") + "\n";
    }

    const schema = this.connection.getSchema() || "public";
    const tables = await this.connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
      [schema]
    );
    const statements: string[] = [];

    for (const tableRow of tables as any[]) {
      const table = tableRow.table_name;
      const columns = await this.connection.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table]
      );
      const primaryKeys = await this.connection.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1
           AND tc.table_name = $2
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY kcu.ordinal_position`,
        [schema, table]
      );
      const pkColumns = primaryKeys.map((row: any) => row.column_name);
      const columnSql = columns.map((column: any) => {
        let type = String(column.data_type).toUpperCase();
        if ((type === "CHARACTER VARYING" || type === "CHARACTER") && column.character_maximum_length) {
          type = `${type}(${column.character_maximum_length})`;
        } else if ((type === "NUMERIC" || type === "DECIMAL") && column.numeric_precision) {
          type = `${type}(${column.numeric_precision}${column.numeric_scale ? `, ${column.numeric_scale}` : ""})`;
        }

        let sql = `  ${this.connection.getGrammar().wrap(column.column_name)} ${type}`;
        if (column.is_nullable === "NO") sql += " NOT NULL";
        if (column.column_default !== null && column.column_default !== undefined) sql += ` DEFAULT ${column.column_default}`;
        return sql;
      });
      if (pkColumns.length > 0) {
        columnSql.push(`  PRIMARY KEY (${pkColumns.map((column: string) => this.connection.getGrammar().wrap(column)).join(", ")})`);
      }
      statements.push(`CREATE TABLE ${this.connection.getGrammar().wrap(`${schema}.${table}`)} (\n${columnSql.join(",\n")}\n);`);
    }

    return statements.join("\n\n") + "\n";
  }

  private async dropAllTables(): Promise<void> {
    const driver = this.connection.getDriverName();
    const grammar = this.connection.getGrammar();

    if (driver === "sqlite") {
      await this.connection.run("PRAGMA foreign_keys = OFF");
      try {
        const rows = await this.connection.query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        );
        for (const row of rows as any[]) {
          await this.connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(String(row.name))}`);
        }
      } finally {
        await this.connection.run("PRAGMA foreign_keys = ON");
      }
      return;
    }

    if (driver === "mysql") {
      const tables = await this.connection.query("SHOW TABLES");
      const key = Object.keys(tables[0] ?? {})[0];
      await this.connection.run("SET FOREIGN_KEY_CHECKS = 0");
      try {
        for (const row of tables as any[]) {
          await this.connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(String(row[key]))}`);
        }
      } finally {
        await this.connection.run("SET FOREIGN_KEY_CHECKS = 1");
      }
      return;
    }

    const schema = this.connection.getSchema() || "public";
    const tables = await this.connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
      [schema]
    );
    for (const row of tables as any[]) {
      await this.connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(`${schema}.${row.table_name}`)} CASCADE`);
    }
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
    const results = await this.getRanRecords();
    const ran = new Set<string>();
    for (const migration of results.keys()) {
      ran.add(migration);
      ran.add(basename(migration));
    }
    return ran;
  }

  private async getRanRecords(): Promise<Map<string, MigrationRecord>> {
    await this.ensureMigrationsTable();
    const results = await this.scopedMigrations()
      .orderBy("id", "asc")
      .get();

    const records = new Map<string, MigrationRecord>();
    for (const row of results as MigrationRecord[]) {
      const migration = toPosixPath(String(row.migration));
      records.set(migration, row);
      records.set(basename(migration), row);
    }
    return records;
  }
}
