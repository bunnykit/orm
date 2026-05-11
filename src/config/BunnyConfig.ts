import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import type { TenantResolver } from "../connection/ConnectionManager.js";
import { Model } from "../model/Model.js";
import { Schema } from "../schema/Schema.js";
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
}

export interface ConfiguredBunny {
  config: BunnyConfig;
  connection: Connection;
}

export function configureBunny(config: BunnyConfig): ConfiguredBunny {
  const connection = new Connection(config.connection);
  ConnectionManager.setDefault(connection);
  Model.setConnection(connection);
  Schema.setConnection(connection);

  if (config.tenancy?.resolveTenant) {
    ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);
  }

  return { config, connection };
}
