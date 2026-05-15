import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import type { TenantResolver } from "../connection/ConnectionManager.js";
import { Model } from "../model/Model.js";
import { Schema } from "../schema/Schema.js";
import { Migrator, type MigratorOptions } from "../migration/Migrator.js";
import { SeederRunner } from "../seeding/Seeder.js";
import { TenantContext } from "../connection/TenantContext.js";
import type { ModelDeclaration } from "../typegen/TypeGenerator.js";
import type { ConnectionConfig } from "../types/index.js";

export interface ModelsPath {
  landlord?: string | string[];
  tenant?: string | string[];
}

export interface BunnyConfig {
  connection: ConnectionConfig;
  migrationsPath?: string | string[];
  seedersPath?: string | string[];
  migrations?: {
    landlord?: string | string[];
    tenant?: string | string[];
    createIfMissing?: boolean | {
      database?: boolean;
      schema?: boolean;
    };
  };
  tenancy?: {
    resolveTenant?: TenantResolver;
    listTenants?: () => string[] | Promise<string[]>;
  };
  modelsPath?: string | string[] | ModelsPath;
  typesOutDir?: string;
  typeDeclarations?: Record<string, string | ModelDeclaration>;
  typeDeclarationModelsDir?: string;
  typeDeclarationImportPrefix?: string;
  typeDeclarationSingularModels?: boolean;
  typeStubs?: boolean;
  logQueries?: boolean;
}

export interface ConfiguredBunny {
  config: BunnyConfig;
  connection: Connection;
  migrator(scope?: "landlord" | "tenant", overrides?: MigratorOptions): Migrator;
  seeder(): SeederRunner;
  migrate(scope?: "landlord" | "tenant", overrides?: MigratorOptions): Promise<void>;
  rollback(steps?: number, scope?: "landlord" | "tenant"): Promise<void>;
  fresh(scope?: "landlord" | "tenant"): Promise<void>;
  seed(): Promise<void>;
}

function resolveMigrationPath(config: BunnyConfig, scope: "landlord" | "tenant"): string | string[] {
  const grouped = config.migrations?.[scope];
  if (grouped) return grouped;
  if (config.migrationsPath) return config.migrationsPath;
  throw new Error(`No migration path configured for scope "${scope}".`);
}

export function configureBunny(config: BunnyConfig): ConfiguredBunny {
  const connection = new Connection(config.connection);
  ConnectionManager.setDefault(connection);
  Model.setConnection(connection);
  Schema.setConnection(connection);

  if (config.tenancy?.resolveTenant) {
    ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);
  }

  if (config.logQueries) {
    Connection.logQueries = true;
  }

  const buildMigrator = (scope: "landlord" | "tenant" = "landlord", overrides: MigratorOptions = {}) => {
    const path = resolveMigrationPath(config, scope);
    const tenantConn = TenantContext.current()?.connection;
    const activeConn = tenantConn ?? connection;
    const options: MigratorOptions = {
      createIfMissing: config.migrations?.createIfMissing,
      ...overrides,
    };
    return new Migrator(activeConn, path, config.typesOutDir, {}, options);
  };

  const buildSeeder = () => {
    const tenantConn = TenantContext.current()?.connection;
    return new SeederRunner(tenantConn ?? connection);
  };

  return {
    config,
    connection,
    migrator: buildMigrator,
    seeder: buildSeeder,
    async migrate(scope = "landlord", overrides = {}) {
      await buildMigrator(scope, overrides).run();
    },
    async rollback(steps = 1, scope = "landlord") {
      await buildMigrator(scope).rollback(steps);
    },
    async fresh(scope = "landlord") {
      await buildMigrator(scope).fresh();
    },
    async seed() {
      if (!config.seedersPath) {
        throw new Error("No seedersPath configured.");
      }
      await buildSeeder().runPaths(config.seedersPath);
    },
  };
}
