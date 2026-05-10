#!/usr/bin/env bun
import { Connection } from "../src/connection/Connection.js";
import { ConnectionManager } from "../src/connection/ConnectionManager.js";
import { TenantContext } from "../src/connection/TenantContext.js";
import { configureBunny } from "../src/config/BunnyConfig.js";
import type { BunnyConfig } from "../src/config/BunnyConfig.js";
import { Migrator } from "../src/migration/Migrator.js";
import { MigrationCreator } from "../src/migration/MigrationCreator.js";
import { SeederRunner } from "../src/seeding/Seeder.js";
import { TypeGenerator } from "../src/typegen/TypeGenerator.js";
import { existsSync } from "fs";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { basename, extname, join, resolve } from "path";
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

type MigrationCommand = "migrate" | "migrate:rollback" | "migrate:status" | "migrate:reset" | "migrate:refresh" | "migrate:fresh";
type MigrationTarget =
  | { scope: "default" }
  | { scope: "landlord" }
  | { scope: "tenants" }
  | { scope: "tenant"; tenantId: string };

function parseEnvPathSetting(value?: string): string | string[] | undefined {
  if (!value) return undefined;
  const paths = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (paths.length === 0) return undefined;
  return paths.length === 1 ? paths[0] : paths;
}

function getDefaultMigrationsPath(config: BunnyConfig): string | string[] {
  return config.migrationsPath || config.migrations?.landlord || "./database/migrations";
}

function getFirstMigrationPath(path: string | string[] | undefined): string | undefined {
  return normalizePathList(path).filter(Boolean)[0];
}

function parseMigrationTarget(args: string[]): MigrationTarget {
  if (args.includes("--landlord")) return { scope: "landlord" };
  if (args.includes("--tenants")) return { scope: "tenants" };
  const tenantFlagIndex = args.indexOf("--tenant");
  if (tenantFlagIndex >= 0) {
    const tenantId = args[tenantFlagIndex + 1];
    if (!tenantId) {
      throw new Error("Usage: bun run bunny migrate --tenant <tenantId>");
    }
    return { scope: "tenant", tenantId };
  }
  return { scope: "default" };
}

function createTypeGeneratorOptions(config: BunnyConfig) {
  const modelRoots = normalizePathList(config.modelsPath || config.typeDeclarationModelsDir);
  return {
    declarations: !config.typeStubs,
    stubs: config.typeStubs,
    modelDeclarations: config.typeDeclarations,
    modelDirectory: modelRoots[0],
    modelDirectories: modelRoots.length > 1 ? modelRoots : undefined,
    modelImportPrefix: config.typeDeclarationImportPrefix,
    singularModels: config.typeDeclarationSingularModels,
    declarationDirName: "types",
  };
}

function createMigrationOptions(config: BunnyConfig) {
  return {
    createIfMissing: config.migrations?.createIfMissing,
  };
}

async function runMigratorCommand(
  command: MigrationCommand,
  migrator: Migrator,
  statusLabel?: string
): Promise<void> {
  if (command === "migrate") {
    await migrator.run();
    return;
  }
  if (command === "migrate:rollback") {
    await migrator.rollback();
    return;
  }
  if (command === "migrate:reset") {
    await migrator.reset();
    return;
  }
  if (command === "migrate:refresh") {
    await migrator.refresh();
    return;
  }
  if (command === "migrate:fresh") {
    await migrator.fresh();
    return;
  }
  const status = await migrator.status();
  if (statusLabel) {
    console.log(statusLabel);
  }
  console.table(status);
}

async function getTenantIds(config: BunnyConfig): Promise<string[]> {
  if (!config.tenancy?.listTenants) {
    throw new Error("Tenant migrations require tenancy.listTenants() in bunny.config.ts.");
  }
  const tenantIds = await config.tenancy.listTenants();
  return tenantIds.map((tenantId) => String(tenantId));
}

async function runTenantMigrationCommand(
  command: MigrationCommand,
  config: BunnyConfig,
  tenantPath: string | string[],
  tenantId: string,
  typesOutDir?: string
): Promise<void> {
  try {
    await TenantContext.run(tenantId, async () => {
      const context = TenantContext.current();
      if (!context) {
        throw new Error(`Tenant "${tenantId}" did not resolve to an active context.`);
      }
      console.log(`Tenant: ${tenantId}`);
      const migrator = new Migrator(context.connection, tenantPath, typesOutDir, createTypeGeneratorOptions(config), {
        tenantId,
        ...createMigrationOptions(config),
      });
      await runMigratorCommand(command, migrator);
    });
  } finally {
    await ConnectionManager.closeTenant(tenantId);
  }
}

async function runConfiguredMigrationCommand(
  command: MigrationCommand,
  config: BunnyConfig,
  connection: Connection,
  target: MigrationTarget
): Promise<void> {
  if (!config.migrations) {
    const migrator = new Migrator(connection, getDefaultMigrationsPath(config), config.typesOutDir, createTypeGeneratorOptions(config));
    await runMigratorCommand(command, migrator);
    return;
  }

  const landlordPath = config.migrations.landlord;
  const tenantPath = config.migrations.tenant;
  const runLandlord = async () => {
    if (!landlordPath) return;
    console.log("Landlord migrations");
    const migrator = new Migrator(connection, landlordPath, config.typesOutDir, createTypeGeneratorOptions(config), createMigrationOptions(config));
    await runMigratorCommand(command, migrator);
  };
  const runAllTenants = async () => {
    if (!tenantPath) return;
    if (!config.tenancy?.resolveTenant) {
      throw new Error("Tenant migrations require tenancy.resolveTenant() in bunny.config.ts.");
    }
    ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);
    const tenantIds = await getTenantIds(config);
    for (const tenantId of tenantIds) {
      await runTenantMigrationCommand(command, config, tenantPath, tenantId);
    }
  };

  if (target.scope === "landlord") {
    await runLandlord();
    return;
  }
  if (target.scope === "tenant") {
    if (!tenantPath) return;
    if (!config.tenancy?.resolveTenant) {
      throw new Error("Tenant migrations require tenancy.resolveTenant() in bunny.config.ts.");
    }
    ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);
    await runTenantMigrationCommand(command, config, tenantPath, target.tenantId);
    return;
  }
  if (target.scope === "tenants") {
    await runAllTenants();
    return;
  }

    if (command === "migrate:rollback") {
      await runAllTenants();
      await runLandlord();
      return;
    }
  await runLandlord();
  await runAllTenants();
}

async function createReplBootstrap(config: BunnyConfig): Promise<string> {
  const tmpRoot = process.env.BUNNY_REPL_TMPDIR || "/private/tmp";
  const dir = join(tmpRoot, "bunny-repl");
  await mkdir(dir, { recursive: true });
  const bootstrapPath = join(dir, `bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  const modelRoots = normalizePathList(config.modelsPath || config.typeDeclarationModelsDir);
  const tsConfigPath = join(process.cwd(), "bunny.config.ts");
  const jsConfigPath = join(process.cwd(), "bunny.config.js");
  const configPath = existsSync(tsConfigPath) ? tsConfigPath : existsSync(jsConfigPath) ? jsConfigPath : null;
  const source = `
    import {
      BelongsTo,
      BelongsToMany,
      Blueprint,
      Builder,
      Collection,
      Connection,
      ConnectionManager,
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
      TenantContext,
      TypeGenerator,
      TypeMapper,
      Model,
      collect,
      configureBunny
    } from "@bunnykit/orm";
    import { existsSync } from "fs";
    import { readdir } from "fs/promises";
    import { basename, extname, join, resolve } from "path";
    import { pathToFileURL } from "url";

    const configPath = ${JSON.stringify(configPath)};
    const configModule = configPath ? await import(pathToFileURL(configPath).href) : null;
    const replConfig = configModule ? (configModule.default || configModule) : ${JSON.stringify(config)};
    const bunny = configureBunny(replConfig);
    const connection = bunny.connection;

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
    const originalTenantContextCurrent = TenantContext.current.bind(TenantContext);
    let activeTenantContext;

    function tenant() {
      return activeTenantContext;
    }

    async function clearTenant() {
      activeTenantContext = undefined;
      return undefined;
    }

    async function useTenant(tenantId) {
      const context = await ConnectionManager.resolveTenant(tenantId);
      if (context.strategy === "schema" && context.schemaMode === "search_path") {
        throw new Error("Persistent REPL tenant context does not support search_path tenants. Use await TenantContext.run(tenantId, () => ...) instead.");
      }
      if (context.strategy === "rls") {
        throw new Error("Persistent REPL tenant context does not support RLS tenants. Use await TenantContext.run(tenantId, () => ...) instead.");
      }
      activeTenantContext = context;
      return context;
    }

    TenantContext.current = () => originalTenantContextCurrent() || activeTenantContext;

    Object.assign(globalThis, {
      Connection,
      Builder,
      Collection,
      ConnectionManager,
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
      TenantContext,
      collect,
      configureBunny,
      db: connection,
      connection,
      bunny,
      config: replConfig,
      Models: loadedModels,
      useTenant,
      clearTenant,
      tenant,
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
      seedersPath: parseEnvPathSetting(process.env.SEEDERS_PATH),
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
      seedersPath: parseEnvPathSetting(process.env.SEEDERS_PATH),
      modelsPath: parseEnvPathSetting(process.env.MODELS_PATH),
    };
  }

  if (allowFallback) {
    return {
      connection: { url: "sqlite://:memory:" },
      migrationsPath: parseEnvPathSetting(process.env.MIGRATIONS_PATH) || "./database/migrations",
      seedersPath: parseEnvPathSetting(process.env.SEEDERS_PATH),
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
    const migrationRoots = normalizePathList(config.migrationsPath || config.migrations?.landlord);
    const targetPath = args[2] || migrationRoots[0] || getFirstMigrationPath(config.migrations?.landlord) || "./database/migrations";
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
  const { connection } = configureBunny(config);

  try {
    if (command === "schema:dump" || command === "schema:squash") {
      const outputPath = args[1] || "./database/schema.sql";
      const migrator = new Migrator(connection, getDefaultMigrationsPath(config), config.typesOutDir, createTypeGeneratorOptions(config), createMigrationOptions(config));
      if (command === "schema:dump") {
        await migrator.dumpSchema(outputPath);
        console.log(`Schema dumped to ${outputPath}`);
      } else {
        await migrator.squash(outputPath);
        console.log(`Schema squashed to ${outputPath}`);
      }
    } else if (command === "migrate") {
      await runConfiguredMigrationCommand(command, config, connection, parseMigrationTarget(args.slice(1)));
    } else if (command === "migrate:rollback") {
      await runConfiguredMigrationCommand(command, config, connection, parseMigrationTarget(args.slice(1)));
    } else if (command === "migrate:reset") {
      await runConfiguredMigrationCommand(command, config, connection, parseMigrationTarget(args.slice(1)));
    } else if (command === "migrate:refresh") {
      await runConfiguredMigrationCommand(command, config, connection, parseMigrationTarget(args.slice(1)));
    } else if (command === "migrate:fresh") {
      await runConfiguredMigrationCommand(command, config, connection, parseMigrationTarget(args.slice(1)));
    } else if (command === "migrate:status") {
      await runConfiguredMigrationCommand(command, config, connection, parseMigrationTarget(args.slice(1)));
    } else if (command === "db:seed") {
      const target = args[1];
      const seederPath = config.seedersPath || "./database/seeders";
      const runner = new SeederRunner(connection);
      if (target) {
        await runner.runTarget(target, seederPath);
      } else {
        await runner.runPaths(seederPath);
      }
    } else {
      console.log("Usage:");
      console.log("  bun run bunny migrate              Run landlord migrations, then all tenant migrations when configured");
      console.log("  bun run bunny migrate --landlord   Run landlord migrations only");
      console.log("  bun run bunny migrate --tenants    Run all tenant migrations only");
      console.log("  bun run bunny migrate --tenant <id> Run one tenant's migrations only");
      console.log("  bun run bunny migrate:make <name> [dir] Create a new migration");
      console.log("  bun run bunny migrate:rollback     Rollback the last batch");
      console.log("  bun run bunny migrate:reset        Rollback all migrations");
      console.log("  bun run bunny migrate:refresh      Reset and rerun migrations");
      console.log("  bun run bunny migrate:fresh        Drop all tables and rerun migrations");
      console.log("  bun run bunny migrate:status       Show migration status");
      console.log("  bun run bunny db:seed              Run seeders from seedersPath");
      console.log("  bun run bunny db:seed <seeder>     Run one seeder by file path or name");
      console.log("  bun run bunny schema:dump [path]   Dump the current database schema");
      console.log("  bun run bunny schema:squash [path] Dump schema and mark configured migrations as ran");
      console.log("  bun run bunny types:generate [dir] Generate model type declarations from DB schema");
      console.log("  bun run bunny repl                 Start a Bunny REPL with Model, Schema, and db loaded");
      console.log("                                     Falls back to in-memory SQLite when no config is present");
    }
  } finally {
    await ConnectionManager.closeAll();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
