#!/usr/bin/env bun
import { Connection } from "../src/connection/Connection.js";
import { Migrator } from "../src/migration/Migrator.js";
import { MigrationCreator } from "../src/migration/MigrationCreator.js";
import { TypeGenerator } from "../src/typegen/TypeGenerator.js";
import type { ConnectionConfig } from "../src/types/index.js";
import { existsSync } from "fs";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { basename, extname, join, resolve } from "path";
import type { ModelDeclaration } from "../src/typegen/TypeGenerator.js";
import { normalizePathList } from "../src/utils.js";
import {
  BelongsTo,
  BelongsToMany,
  Blueprint,
  Grammar,
  HasMany,
  HasManyThrough,
  HasOne,
  HasOneThrough,
  Migration,
  MorphMany,
  MorphMap,
  MorphOne,
  MorphTo,
  MorphToMany,
  MySqlGrammar,
  ObserverRegistry,
  PostgresGrammar,
  Schema,
  SQLiteGrammar,
  TypeMapper,
  Builder,
  Model,
} from "../src/index.js";

interface BunnyConfig {
  connection: ConnectionConfig;
  migrationsPath: string | string[];
  modelsPath?: string | string[];
  typesOutDir?: string;
  typeDeclarations?: Record<string, string | ModelDeclaration>;
  typeDeclarationModelsDir?: string;
  typeDeclarationImportPrefix?: string;
  typeDeclarationSingularModels?: boolean;
  typeStubs?: boolean;
}

function parseEnvPathSetting(value?: string): string | string[] | undefined {
  if (!value) return undefined;
  const paths = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (paths.length === 0) return undefined;
  return paths.length === 1 ? paths[0] : paths;
}

async function createReplBootstrap(config: BunnyConfig): Promise<string> {
  const tmpRoot = process.env.BUNNY_REPL_TMPDIR || "/private/tmp";
  const dir = join(tmpRoot, "bunny-repl");
  await mkdir(dir, { recursive: true });
  const bootstrapPath = join(dir, `bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  const modelRoots = normalizePathList(config.modelsPath || config.typeDeclarationModelsDir);
  const source = `
    import {
      BelongsTo,
      BelongsToMany,
      Blueprint,
      Builder,
      Connection,
      Grammar,
      HasMany,
      HasManyThrough,
      HasOne,
      HasOneThrough,
      Migration,
      MigrationCreator,
      Migrator,
      MorphMany,
      MorphMap,
      MorphOne,
      MorphTo,
      MorphToMany,
      MySqlGrammar,
      ObserverRegistry,
      PostgresGrammar,
      Schema,
      SQLiteGrammar,
      TypeGenerator,
      TypeMapper,
      Model
    } from "@bunnykit/orm";
    import { existsSync } from "fs";
    import { readdir } from "fs/promises";
    import { basename, extname, join, resolve } from "path";
    import { pathToFileURL } from "url";

    const connection = new Connection(${JSON.stringify(config.connection)});
    Model.setConnection(connection);
    Schema.setConnection(connection);

    const modelRoots = ${JSON.stringify(modelRoots)};

    async function walkFiles(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.name === "types") continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await walkFiles(fullPath));
          continue;
        }
        if (!entry.isFile()) continue;
        const name = entry.name;
        if (name.endsWith(".d.ts") || name.endsWith(".test.ts") || name.endsWith(".spec.ts")) continue;
        if (![".ts", ".js", ".mts", ".mjs", ".cts", ".cjs"].includes(extname(name))) continue;
        files.push(fullPath);
      }
      return files;
    }

    async function loadModels(roots) {
      const loaded = {};
      for (const root of roots) {
        const resolvedRoot = resolve(process.cwd(), root);
        if (!existsSync(resolvedRoot)) continue;
        const files = await walkFiles(resolvedRoot);
        for (const file of files.sort()) {
          const mod = await import(pathToFileURL(file).href);
          for (const [exportName, exported] of Object.entries(mod)) {
            if (exportName === "default") continue;
            if (typeof exported === "function" && exported.prototype instanceof Model) {
              const modelName = exportName;
              loaded[modelName] = exported;
              globalThis[modelName] = exported;
            }
          }
          if (typeof mod.default === "function" && mod.default.prototype instanceof Model) {
            const modelName = mod.default.name || basename(file, extname(file));
            loaded[modelName] = mod.default;
            globalThis[modelName] = mod.default;
          }
        }
      }
      globalThis.Models = loaded;
      return loaded;
    }

    const loadedModels = await loadModels(modelRoots);

    Object.assign(globalThis, {
      Connection,
      Builder,
      Blueprint,
      Grammar,
      SQLiteGrammar,
      MySqlGrammar,
      PostgresGrammar,
      Model,
      HasMany,
      BelongsTo,
      HasOne,
      HasManyThrough,
      HasOneThrough,
      BelongsToMany,
      MorphMap,
      MorphTo,
      MorphOne,
      MorphMany,
      MorphToMany,
      ObserverRegistry,
      Migration,
      Migrator,
      MigrationCreator,
      TypeGenerator,
      TypeMapper,
      Schema,
      db: connection,
      connection,
      Models: loadedModels,
    });

    console.log(\`Bunny REPL ready. Loaded \${Object.keys(loadedModels).length} model classes from modelsPath.\`);
  `;
  await writeFile(bootstrapPath, source, "utf-8");
  return bootstrapPath;
}

async function runRepl(config: BunnyConfig, replArgs: string[]): Promise<number> {
  const bootstrapPath = await createReplBootstrap(config);
  await mkdir("/private/tmp/bunny-repl-cache", { recursive: true });
  const proc = Bun.spawn(["bun", "repl", ...replArgs], {
    env: {
      ...process.env,
      TMPDIR: "/private/tmp",
      TEMP: "/private/tmp",
      TMP: "/private/tmp",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "/private/tmp/bunny-repl-cache",
    },
    terminal: {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      data(_terminal, data) {
        process.stdout.write(data);
      },
    },
  });

  const stdin = process.stdin;
  const terminal = proc.terminal!;
  const restoreRawMode = stdin.isTTY && typeof stdin.setRawMode === "function";

  if (restoreRawMode) {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const onData = (chunk: Buffer) => {
    terminal.write(chunk);
  };
  stdin.on("data", onData);

  const cleanup = async () => {
    stdin.off("data", onData);
    if (restoreRawMode) {
      stdin.setRawMode(false);
    }
    terminal.close();
    await rm(bootstrapPath, { force: true });
  };

  process.once("SIGINT", () => {
    terminal.close();
  });
  process.once("SIGTERM", () => {
    terminal.close();
  });

  terminal.write(`.load ${bootstrapPath}\n`);

  const exitCode = await proc.exited;
  await cleanup();
  return exitCode;
}

async function loadConfig(allowFallback = false): Promise<BunnyConfig> {
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
      migrationsPath: parseEnvPathSetting(process.env.MIGRATIONS_PATH) || "./database/migrations",
      modelsPath: parseEnvPathSetting(process.env.MODELS_PATH),
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
      migrationsPath: parseEnvPathSetting(process.env.MIGRATIONS_PATH) || "./database/migrations",
      modelsPath: parseEnvPathSetting(process.env.MODELS_PATH),
    };
  }

  if (allowFallback) {
    return {
      connection: { url: "sqlite://:memory:" },
      migrationsPath: parseEnvPathSetting(process.env.MIGRATIONS_PATH) || "./database/migrations",
      modelsPath: parseEnvPathSetting(process.env.MODELS_PATH),
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
      console.error("Usage: bun run bunny migrate:make <name> [directory]");
      process.exit(1);
    }
    const config = await loadConfig();
    const creator = new MigrationCreator();
    const migrationRoots = normalizePathList(config.migrationsPath);
    const targetPath = args[2] || migrationRoots[0] || "./database/migrations";
    const path = await creator.create(name, targetPath);
    console.log(`Created migration: ${path}`);
    return;
  }

  if (command === "types:generate") {
    const config = await loadConfig();
    const connection = new Connection(config.connection);
    const modelRoots = normalizePathList(config.modelsPath || config.typeDeclarationModelsDir);
    const explicitOutDir = args[1];
    const useModelTypesFolder = !explicitOutDir && !config.typesOutDir && modelRoots.length > 0;
    const outDir = explicitOutDir || config.typesOutDir || (useModelTypesFolder ? join(modelRoots[0], "types") : "./generated/models");
    const generator = new TypeGenerator(connection, {
      outDir,
      stubs: config.typeStubs,
      declarations: !config.typeStubs,
      modelDeclarations: config.typeDeclarations,
      modelDirectory: !useModelTypesFolder ? modelRoots[0] : undefined,
      modelDirectories: useModelTypesFolder ? modelRoots : undefined,
      modelImportPrefix: config.typeDeclarationImportPrefix,
      singularModels: config.typeDeclarationSingularModels,
      declarationDirName: "types",
    });
    await generator.generate();
    const outputLabel = useModelTypesFolder ? modelRoots.map((root) => join(root, "types")).join(", ") : outDir;
    console.log(`Generated model type declarations in ${outputLabel}`);
    return;
  }

  if (command === "repl") {
    const config = await loadConfig(true);
    const replArgs = args.slice(1);
    const exitCode = await runRepl(config, replArgs);
    process.exit(exitCode);
  }

  const config = await loadConfig();
  const connection = new Connection(config.connection);
  const modelRoots = normalizePathList(config.modelsPath || config.typeDeclarationModelsDir);
  const migrator = new Migrator(connection, config.migrationsPath, config.typesOutDir, {
    declarations: !config.typeStubs,
    stubs: config.typeStubs,
    modelDeclarations: config.typeDeclarations,
    modelDirectory: modelRoots[0],
    modelDirectories: modelRoots.length > 1 ? modelRoots : undefined,
    modelImportPrefix: config.typeDeclarationImportPrefix,
    singularModels: config.typeDeclarationSingularModels,
    declarationDirName: "types",
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
    console.log("  bun run bunny migrate:make <name> [dir] Create a new migration");
    console.log("  bun run bunny migrate:rollback     Rollback the last batch");
    console.log("  bun run bunny migrate:status       Show migration status");
    console.log("  bun run bunny types:generate [dir] Generate model type declarations from DB schema");
    console.log("  bun run bunny repl                 Start a Bunny REPL with Model, Schema, and db loaded");
    console.log("                                     Falls back to in-memory SQLite when no config is present");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
