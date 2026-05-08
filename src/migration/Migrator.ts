import { existsSync } from "fs";
import { readdir } from "fs/promises";
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

export class Migrator {
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
        await migration.up();
        await new Builder(this.connection, "migrations").insert({
          migration: file.id,
          batch,
        });
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
        await migration.down();
        await new Builder(this.connection, "migrations")
          .where("id", record.id)
          .delete();
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
