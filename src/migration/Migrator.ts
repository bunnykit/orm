import { readdir } from "fs/promises";
import { join, resolve } from "path";
import { Connection } from "../connection/Connection.js";
import { Schema } from "../schema/Schema.js";
import { Blueprint } from "../schema/Blueprint.js";
import { Builder } from "../query/Builder.js";
import { TypeGenerator } from "../typegen/TypeGenerator.js";
import type { TypeGeneratorOptions } from "../typegen/TypeGenerator.js";
import type { Migration } from "./Migration.js";

interface MigrationRecord {
  id: number;
  migration: string;
  batch: number;
}

export class Migrator {
  constructor(
    private connection: Connection,
    private path: string,
    private typesOutDir?: string,
    private typeGeneratorOptions: Omit<TypeGeneratorOptions, "outDir"> = {}
  ) {
    Schema.setConnection(connection);
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

  private async getRan(): Promise<string[]> {
    await this.ensureMigrationsTable();
    const results = await new Builder(this.connection, "migrations")
      .orderBy("id", "asc")
      .get();
    return results.map((row: any) => row.migration);
  }

  private async getLastBatchNumber(): Promise<number> {
    const result = await new Builder(this.connection, "migrations")
      .select("MAX(batch) as batch")
      .first();
    return (result as any)?.batch || 0;
  }

  private async getMigrationFiles(): Promise<string[]> {
    const files = await readdir(this.path);
    return files
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .sort((a, b) => a.localeCompare(b));
  }

  async run(): Promise<void> {
    const ran = await this.getRan();
    const files = await this.getMigrationFiles();
    const pending = files.filter((f) => !ran.includes(f));

    if (pending.length === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    const batch = (await this.getLastBatchNumber()) + 1;

    await this.connection.beginTransaction();
    try {
      for (const file of pending) {
        const migration = await this.resolve(file);
        console.log(`Migrating: ${file}`);
        await migration.up();
        await new Builder(this.connection, "migrations").insert({
          migration: file,
          batch,
        });
        console.log(`Migrated:  ${file}`);
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
    if (!this.typesOutDir) return;
    const generator = new TypeGenerator(this.connection, {
      declarations: true,
      ...this.typeGeneratorOptions,
      outDir: this.typesOutDir,
    });
    await generator.generate();
    console.log(`Regenerated types in ${this.typesOutDir}`);
  }

  async status(): Promise<{ migration: string; status: string }[]> {
    const ran = await this.getRan();
    const files = await this.getMigrationFiles();
    return files.map((file) => ({
      migration: file,
      status: ran.includes(file) ? "Ran" : "Pending",
    }));
  }

  private async resolve(file: string): Promise<Migration> {
    const fullPath = resolve(this.path, file);
    const module = await import(fullPath);
    const MigrationClass = module.default || Object.values(module)[0];
    if (!MigrationClass) {
      throw new Error(`Migration ${file} does not export a class.`);
    }
    return new MigrationClass();
  }
}
