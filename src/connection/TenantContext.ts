import { AsyncLocalStorage } from "node:async_hooks";
import type { Connection } from "./Connection.js";
import { ConnectionManager } from "./ConnectionManager.js";

export interface ActiveTenantContext {
  tenantId: string;
  connection: Connection;
  connectionName: string;
  strategy: "database" | "schema" | "rls";
  schema?: string;
  schemaMode?: "qualify" | "search_path";
  rlsTenantId?: string;
  rlsSetting?: string;
}

const storage = new AsyncLocalStorage<ActiveTenantContext>();

export class TenantContext {
  static current(): ActiveTenantContext | undefined {
    return storage.getStore();
  }

  static async run<T>(tenantId: string, callback: () => T | Promise<T>): Promise<T> {
    const context = await ConnectionManager.resolveTenant(tenantId);
    if (context.strategy === "schema" && context.schema && context.schemaMode === "search_path") {
      return await context.connection.withSearchPath(context.schema, async (connection) => {
        return await storage.run({ ...context, connection }, callback);
      });
    }
    if (context.strategy === "rls") {
      return await context.connection.withTenant(context.rlsTenantId || context.tenantId, async (connection) => {
        return await storage.run({ ...context, connection }, callback);
      }, context.rlsSetting);
    }
    return await storage.run(context, callback);
  }
}
