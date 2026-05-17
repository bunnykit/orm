import { AsyncLocalStorage } from "node:async_hooks";
import type { Connection } from "./Connection.js";

const storage = new AsyncLocalStorage<Connection>();

export class TransactionContext {
  static current(): Connection | undefined {
    return storage.getStore();
  }

  static run<T>(connection: Connection, callback: () => T | Promise<T>): Promise<T> {
    return storage.run(connection, callback) as Promise<T>;
  }
}
