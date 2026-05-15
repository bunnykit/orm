import { Builder } from "./Builder.js";
import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";

function resolveDefaultConnection(): Connection {
  const tenant = TenantContext.current()?.connection;
  if (tenant) return tenant;
  const fallback = ConnectionManager.getDefault();
  if (!fallback) {
    throw new Error("No default connection set. Call Model.setConnection() or ConnectionManager.setDefault() first.");
  }
  return fallback;
}

export const DB = {
  table<T extends Record<string, any> = Record<string, any>>(name: string): Builder<T> {
    return new Builder<T>(resolveDefaultConnection(), name);
  },

  connection(name: string) {
    const conn = ConnectionManager.require(name);
    return {
      table<T extends Record<string, any> = Record<string, any>>(table: string): Builder<T> {
        return new Builder<T>(conn, table);
      },
    };
  },

  tenant<T>(tenantId: string, callback: () => T | Promise<T>): Promise<T> {
    return TenantContext.run(tenantId, callback);
  },

  raw<T = any>(sql: string, bindings: any[] = []): Promise<T[]> {
    return resolveDefaultConnection().query(sql, bindings) as Promise<T[]>;
  },
};
