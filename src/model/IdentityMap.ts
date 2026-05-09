import { AsyncLocalStorage } from "node:async_hooks";
import type { Model } from "./Model.js";

const storage = new AsyncLocalStorage<Map<string, Model>>();

export class IdentityMap {
  static current(): Map<string, Model> | undefined {
    return storage.getStore();
  }

  static async run<T>(callback: () => T | Promise<T>): Promise<T> {
    return await storage.run(new Map<string, Model>(), callback);
  }

  static get(table: string, key: string | number): Model | undefined {
    const map = this.current();
    if (!map) return undefined;
    return map.get(`${table}:${String(key)}`);
  }

  static set(table: string, key: string | number, model: Model): void {
    const map = this.current();
    if (!map) return;
    map.set(`${table}:${String(key)}`, model);
  }

  static clear(): void {
    const map = this.current();
    if (!map) return;
    map.clear();
  }

  static delete(table: string, key: string | number): void {
    const map = this.current();
    if (!map) return;
    map.delete(`${table}:${String(key)}`);
  }
}
