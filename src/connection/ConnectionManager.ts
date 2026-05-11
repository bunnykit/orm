import { Connection } from "./Connection.js";
import type { ConnectionConfig } from "../types/index.js";
import type { ActiveTenantContext } from "./TenantContext.js";

export interface TenantCachePolicy {
  ttl?: number;
  closeOnPurge?: boolean;
}

type TenantResolutionOptions = TenantCachePolicy & {
  cache?: TenantCachePolicy;
};

export type TenantResolution =
  | ({ strategy: "database"; name: string; config: ConnectionConfig } & TenantResolutionOptions)
  | ({ strategy: "schema"; name: string; config?: ConnectionConfig; connection?: string | Connection; schema: string; mode?: "qualify" | "search_path" } & TenantResolutionOptions)
  | ({ strategy: "rls"; name: string; config?: ConnectionConfig; connection?: string | Connection; tenantId?: string; setting?: string; role?: string } & TenantResolutionOptions);

export type TenantResolver = (tenantId: string) => TenantResolution | Promise<TenantResolution>;

export class ConnectionManager {
  private static defaultConnection?: Connection;
  private static connections = new Map<string, Connection>();
  private static tenantResolver?: TenantResolver;
  private static tenantCache = new Map<string, ActiveTenantContext>();

  static setDefault(connection: Connection): void {
    this.defaultConnection = connection;
  }

  static getDefault(): Connection | undefined {
    return this.defaultConnection;
  }

  static add(name: string, connection: Connection | ConnectionConfig): Connection {
    const resolved = connection instanceof Connection ? connection : new Connection(connection);
    this.connections.set(name, resolved);
    return resolved;
  }

  static get(name: string): Connection | undefined {
    return this.connections.get(name);
  }

  static require(name: string): Connection {
    const connection = this.get(name);
    if (!connection) {
      throw new Error(`No connection registered for "${name}".`);
    }
    return connection;
  }

  static setTenantResolver(resolver: TenantResolver): void {
    this.tenantResolver = resolver;
    this.tenantCache.clear();
  }

  static async resolveTenant(tenantId: string): Promise<ActiveTenantContext> {
    const cached = this.tenantCache.get(tenantId);
    if (cached) {
      if (!cached.expiresAt || cached.expiresAt > Date.now()) return cached;
      await this.closeTenant(tenantId);
    }
    if (!this.tenantResolver) {
      throw new Error("No tenant resolver configured.");
    }

    const resolution = await this.tenantResolver(tenantId);
    const policy = { ...resolution.cache, ttl: resolution.ttl ?? resolution.cache?.ttl, closeOnPurge: resolution.closeOnPurge ?? resolution.cache?.closeOnPurge };
    const resolvedAt = Date.now();
    const schema = resolution.strategy === "schema" ? resolution.schema : undefined;
    const schemaMode = resolution.strategy === "schema" ? resolution.mode || "qualify" : undefined;
    let ownsConnection = false;
    let connection = (resolution.strategy === "schema" || resolution.strategy === "rls") && resolution.connection instanceof Connection
      ? resolution.connection
      : (resolution.strategy === "schema" || resolution.strategy === "rls") && typeof resolution.connection === "string"
      ? this.require(resolution.connection)
      : this.connections.get(resolution.name);
    if (!connection) {
      if ((resolution.strategy === "schema" || resolution.strategy === "rls") && !resolution.config) {
        connection = this.defaultConnection;
      }
      if (!connection && !resolution.config) {
        throw new Error(`No connection config or registered connection found for tenant "${tenantId}".`);
      }
    }
    if (!connection) {
      const config = resolution.config;
      if (!config) {
        throw new Error(`No connection config or registered connection found for tenant "${tenantId}".`);
      }
      connection = new Connection(config, { schema });
      this.connections.set(resolution.name, connection);
      ownsConnection = true;
    } else if (schema && schemaMode === "qualify") {
      connection = connection.withSchema(schema);
    }

    const context: ActiveTenantContext = {
      tenantId,
      connection,
      connectionName: resolution.name,
      strategy: resolution.strategy,
      resolvedAt,
      expiresAt: policy.ttl ? resolvedAt + policy.ttl : undefined,
      closeOnPurge: policy.closeOnPurge ?? ownsConnection,
      ownsConnection,
      schema,
      schemaMode,
      rlsTenantId: resolution.strategy === "rls" ? resolution.tenantId || tenantId : undefined,
      rlsSetting: resolution.strategy === "rls" ? resolution.setting || "app.tenant_id" : undefined,
      rlsRole: resolution.strategy === "rls" ? resolution.role : undefined,
    };
    this.tenantCache.set(tenantId, context);
    return context;
  }

  static getResolvedTenant(tenantId: string): ActiveTenantContext | undefined {
    const context = this.tenantCache.get(tenantId);
    if (!context || !context.expiresAt || context.expiresAt > Date.now()) return context;
    this.tenantCache.delete(tenantId);
    return undefined;
  }

  static purgeTenant(tenantId: string): void {
    this.tenantCache.delete(tenantId);
  }

  static async purgeExpiredTenants(options: { close?: boolean } = {}): Promise<string[]> {
    const now = Date.now();
    const purged: string[] = [];
    for (const [tenantId, context] of [...this.tenantCache.entries()]) {
      if (!context.expiresAt || context.expiresAt > now) continue;
      purged.push(tenantId);
      if (options.close ?? context.closeOnPurge) {
        await this.closeTenant(tenantId);
      } else {
        this.tenantCache.delete(tenantId);
      }
    }
    return purged;
  }

  static async closeTenant(tenantId: string): Promise<void> {
    const context = this.tenantCache.get(tenantId);
    if (!context) return;
    this.tenantCache.delete(tenantId);
    if (!context.closeOnPurge) return;

    const storedConnection = this.connections.get(context.connectionName);
    if (storedConnection) {
      this.connections.delete(context.connectionName);
      await storedConnection.close();
    }
    if (context.ownsConnection && context.connection !== storedConnection) {
      await context.connection.close();
    }
  }

  static async closeAll(): Promise<void> {
    const connections = new Set<Connection>(this.connections.values());
    if (this.defaultConnection) connections.add(this.defaultConnection);

    this.connections.clear();
    this.tenantCache.clear();
    this.defaultConnection = undefined;
    this.tenantResolver = undefined;

    for (const connection of connections) {
      await connection.close();
    }
  }
}
