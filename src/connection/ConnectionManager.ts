import { Connection } from "./Connection.js";
import type { ConnectionConfig } from "../types/index.js";
import type { ActiveTenantContext } from "./TenantContext.js";

export type TenantResolution =
  | { strategy: "database"; name: string; config: ConnectionConfig }
  | { strategy: "schema"; name: string; config?: ConnectionConfig; connection?: string | Connection; schema: string; mode?: "qualify" | "search_path" }
  | { strategy: "rls"; name: string; config?: ConnectionConfig; connection?: string | Connection; tenantId?: string; setting?: string };

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
    if (cached) return cached;
    if (!this.tenantResolver) {
      throw new Error("No tenant resolver configured.");
    }

    const resolution = await this.tenantResolver(tenantId);
    const schema = resolution.strategy === "schema" ? resolution.schema : undefined;
    const schemaMode = resolution.strategy === "schema" ? resolution.mode || "qualify" : undefined;
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
    } else if (schema && schemaMode === "qualify") {
      connection = connection.withSchema(schema);
    }

    const context: ActiveTenantContext = {
      tenantId,
      connection,
      connectionName: resolution.name,
      strategy: resolution.strategy,
      schema,
      schemaMode,
      rlsTenantId: resolution.strategy === "rls" ? resolution.tenantId || tenantId : undefined,
      rlsSetting: resolution.strategy === "rls" ? resolution.setting || "app.tenant_id" : undefined,
    };
    this.tenantCache.set(tenantId, context);
    return context;
  }

  static getResolvedTenant(tenantId: string): ActiveTenantContext | undefined {
    return this.tenantCache.get(tenantId);
  }

  static purgeTenant(tenantId: string): void {
    this.tenantCache.delete(tenantId);
  }

  static async closeTenant(tenantId: string): Promise<void> {
    const context = this.tenantCache.get(tenantId);
    if (!context) return;
    this.tenantCache.delete(tenantId);
    const connection = this.connections.get(context.connectionName);
    this.connections.delete(context.connectionName);
    await connection?.close();
  }

  static async closeAll(): Promise<void> {
    const connections = new Set<Connection>(this.connections.values());
    if (this.defaultConnection) connections.add(this.defaultConnection);
    this.connections.clear();
    this.tenantCache.clear();
    for (const connection of connections) {
      await connection.close();
    }
  }
}
