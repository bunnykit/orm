#!/usr/bin/env bun
import { Connection } from "../src/connection/Connection.js";
import { Migrator } from "../src/migration/Migrator.js";
import { MigrationCreator } from "../src/migration/MigrationCreator.js";
import { TypeGenerator } from "../src/typegen/TypeGenerator.js";
import type { ConnectionConfig } from "../src/types/index.js";
import { existsSync } from "fs";
import { join } from "path";
import type { ModelDeclaration } from "../src/typegen/TypeGenerator.js";

interface BunnyConfig {
  connection: ConnectionConfig;
  migrationsPath: string;
  typesOutDir?: string;
  typeDeclarations?: Record<string, string | ModelDeclaration>;
  typeDeclarationModelsDir?: string;
  typeDeclarationImportPrefix?: string;
  typeDeclarationSingularModels?: boolean;
  typeStubs?: boolean;
}

async function loadConfig(): Promise<BunnyConfig> {
  const configPath = join(process.cwd(), "bunny.config.ts");
  if (existsSync(configPath)) {
    const mod = await import(configPath);
    return mod.default || mod;
  }

  const jsConfigPath = join(process.cwd(), "bunny.config.js");
  if (existsSync(jsConfigPath)) {
    const mod = await import(jsConfigPath);
    return mod.default || mod;
  }

  // Fallback to environment variables
  const url = process.env.DATABASE_URL;
  if (url) {
    return {
      connection: { url },
      migrationsPath: process.env.MIGRATIONS_PATH || "./database/migrations",
    };
  }

  const driver = process.env.DB_CONNECTION as any;
  if (driver) {
    return {
      connection: {
        driver,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
        database: process.env.DB_DATABASE,
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        filename: process.env.DB_DATABASE,
      },
      migrationsPath: process.env.MIGRATIONS_PATH || "./database/migrations",
    };
  }

  throw new Error(
    "No database configuration found. Create bunny.config.ts or set DATABASE_URL / DB_CONNECTION environment variables."
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "migrate:make") {
    const name = args[1];
    if (!name) {
      console.error("Usage: bun run bunny migrate:make <name>");
      process.exit(1);
    }
    const config = await loadConfig();
    const creator = new MigrationCreator();
    const path = await creator.create(name, config.migrationsPath);
    console.log(`Created migration: ${path}`);
    return;
  }

  if (command === "types:generate") {
    const config = await loadConfig();
    const connection = new Connection(config.connection);
    const outDir = args[1] || config.typesOutDir || "./generated/models";
    const generator = new TypeGenerator(connection, {
      outDir,
      stubs: config.typeStubs,
      declarations: !config.typeStubs,
      modelDeclarations: config.typeDeclarations,
      modelDirectory: config.typeDeclarationModelsDir,
      modelImportPrefix: config.typeDeclarationImportPrefix,
      singularModels: config.typeDeclarationSingularModels,
    });
    await generator.generate();
    console.log(`Generated model type declarations in ${outDir}`);
    return;
  }

  const config = await loadConfig();
  const connection = new Connection(config.connection);
  const migrator = new Migrator(connection, config.migrationsPath, config.typesOutDir, {
    declarations: !config.typeStubs,
    stubs: config.typeStubs,
    modelDeclarations: config.typeDeclarations,
    modelDirectory: config.typeDeclarationModelsDir,
    modelImportPrefix: config.typeDeclarationImportPrefix,
    singularModels: config.typeDeclarationSingularModels,
  });

  if (command === "migrate") {
    await migrator.run();
  } else if (command === "migrate:rollback") {
    await migrator.rollback();
  } else if (command === "migrate:status") {
    const status = await migrator.status();
    console.table(status);
  } else {
    console.log("Usage:");
    console.log("  bun run bunny migrate              Run pending migrations");
    console.log("  bun run bunny migrate:make <name>  Create a new migration");
    console.log("  bun run bunny migrate:rollback     Rollback the last batch");
    console.log("  bun run bunny migrate:status       Show migration status");
    console.log("  bun run bunny types:generate [dir] Generate model type declarations from DB schema");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
