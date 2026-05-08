import type { Model } from "./Model.js";

export class MorphMap {
  private static map = new Map<string, typeof Model>();

  static register(name: string, model: typeof Model): void {
    this.map.set(name, model);
  }

  static get(name: string): typeof Model | undefined {
    return this.map.get(name);
  }

  static keys(): string[] {
    return Array.from(this.map.keys());
  }
}
