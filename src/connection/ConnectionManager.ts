import { Connection } from "./Connection.js";
import type { ConnectionConfig } from "../types/index.js";
import type { ActiveTenantContext } from "./TenantContext.js";

export type TenantResolution =
  | { strategy: "database"; name: string; config: ConnectionConfig }
  | { strategy: "schema"; name: string; config?: ConnectionConfig; connection?: string | Connection; schema: string; mode?: "qualify" | "search_path" }
  | { strategy: "rls"; name: string; config?: ConnectionConfig; connection?: string | Connection; tenantId?: string; setting?: string };

export type TenantResolver = (tenantId: string) => TenantResolution | Promise<TenantResolution>;

export interface PoolConfig {
  maxConnections?: number;
  minConnections?: number;
  idleTimeout?: number;
}

interface PooledConnection {
  connection: Connection;
  lastUsed: number;
  inUse: boolean;
}

interface PoolWaiter {
  resolve: (connection: Connection) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ConnectionManager {
  private static defaultConnection?: Connection;
  private static connections = new Map<string, Connection>();
  private static pools = new Map<string, PooledConnection[]>();
  private static poolConfigs = new Map<string, PoolConfig>();
  private static tenantResolver?: TenantResolver;
  private static tenantCache = new Map<string, ActiveTenantContext>();
  private static waiters = new Map<string, PoolWaiter[]>();

  static setDefault(connection: Connection): void {
    this.defaultConnection = connection;
  }

  static getDefault(): Connection | undefined {
    return this.defaultConnection;
  }

  static setPoolConfig(name: string, config: PoolConfig): void {
    this.poolConfigs.set(name, { maxConnections: 10, minConnections: 1, idleTimeout: 30000, ...config });
  }

  static getPoolConfig(name: string): PoolConfig | undefined {
    return this.poolConfigs.get(name);
  }

  private static async getPooledConnection(name: string, config: ConnectionConfig): Promise<Connection> {
    const poolConfig = this.poolConfigs.get(name) || { maxConnections: 10, minConnections: 1, idleTimeout: 30000 };
    let pool = this.pools.get(name);

    if (!pool) {
      pool = [];
      this.pools.set(name, pool);
    }

    const now = Date.now();
    const idleTimeout = poolConfig.idleTimeout || 30000;

    while (pool.length > 0) {
      const idx = pool.findIndex((c) => !c.inUse && (now - c.lastUsed) < idleTimeout);
      if (idx === -1) break;

      const pooled = pool[idx];
      pool.splice(idx, 1);

      try {
        await pooled.connection.query("SELECT 1");
        pooled.inUse = true;
        return pooled.connection;
      } catch {
        await pooled.connection.close().catch(() => null);
      }
    }

    if (pool.length < (poolConfig.maxConnections || 10)) {
      const connection = new Connection(config);
      pool.push({ connection, lastUsed: Date.now(), inUse: true });
      return connection;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeWaiter(name, waiter);
        reject(new Error(`Connection pool exhausted for "${name}"`));
      }, 30000);

      const waiter: PoolWaiter = { resolve, reject, timer };
      let poolWaiters = this.waiters.get(name);
      if (!poolWaiters) {
        poolWaiters = [];
        this.waiters.set(name, poolWaiters);
      }
      poolWaiters.push(waiter);
    });
  }

  private static removeWaiter(name: string, waiter: PoolWaiter): void {
    const poolWaiters = this.waiters.get(name);
    if (!poolWaiters) return;
    const idx = poolWaiters.indexOf(waiter);
    if (idx !== -1) poolWaiters.splice(idx, 1);
  }

  private static async releasePooledConnection(name: string, connection: Connection): Promise<void> {
    const pool = this.pools.get(name);
    if (!pool) return;

    const pooled = pool.find((p) => p.connection === connection);
    if (!pooled) return;

    // Safety: roll back any leaked transaction before returning to pool
    if (pooled.connection.isInTransaction()) {
      try {
        await pooled.connection.rollback();
      } catch {
        // Connection may already be dead; ignore rollback errors
      }
    }

    // Hand off directly to a waiter if one exists
    const poolWaiters = this.waiters.get(name);
    if (poolWaiters && poolWaiters.length > 0) {
      const waiter = poolWaiters.shift()!;
      clearTimeout(waiter.timer);
      pooled.lastUsed = Date.now();
      waiter.resolve(connection);
      return;
    }

    pooled.inUse = false;
    pooled.lastUsed = Date.now();
  }

  static add(name: string, connection: Connection | ConnectionConfig): Connection {
    const resolved = connection instanceof Connection ? connection : new Connection(connection);
    this.connections.set(name, resolved);
    return resolved;
  }

  static get(name: string): Connection | undefined {
    return this.connections.get(name);
  }

  static async getPooled(name: string, config?: ConnectionConfig): Promise<Connection> {
    if (config) {
      return this.getPooledConnection(name, config);
    }
    const existing = this.connections.get(name);
    if (existing) return existing;
    throw new Error(`No connection registered for "${name}". Use add() first or provide config.`);
  }

  static async release(name: string, connection: Connection): Promise<void> {
    await this.releasePooledConnection(name, connection);
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

    for (const pool of this.pools.values()) {
      for (const { connection } of pool) {
        connections.add(connection);
      }
    }

    if (this.defaultConnection) connections.add(this.defaultConnection);
    this.connections.clear();
    this.pools.clear();
    this.tenantCache.clear();

    for (const connection of connections) {
      await connection.close();
    }
  }
}
