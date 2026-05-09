import type { ModelAttributeInput, ModelConstructor } from "../model/Model.js";
import { Model } from "../model/Model.js";

export type FactoryDefinition<T extends Model> = (sequence: number) => ModelAttributeInput<T>;
export type FactoryState<T extends Model> = ModelAttributeInput<T> | ((attributes: ModelAttributeInput<T>, sequence: number) => ModelAttributeInput<T>);

export class Factory<T extends Model> {
  private amount = 1;
  private states: FactoryState<T>[] = [];

  constructor(
    private model: ModelConstructor<T>,
    private definition: FactoryDefinition<T>
  ) {}

  count(amount: number): Factory<T> {
    const next = this.clone();
    next.amount = Math.max(0, amount);
    return next;
  }

  state(state: FactoryState<T>): Factory<T> {
    const next = this.clone();
    next.states = [...next.states, state];
    return next;
  }

  make(overrides: ModelAttributeInput<T> = {}): T | T[] {
    const models = Array.from({ length: this.amount }, (_, index) => {
      const attributes = this.attributesFor(index + 1, overrides);
      return new this.model(attributes) as T;
    });
    return this.amount === 1 ? models[0] : models;
  }

  async create(overrides: ModelAttributeInput<T> = {}): Promise<T | T[]> {
    const records = Array.from({ length: this.amount }, (_, index) => this.attributesFor(index + 1, overrides));
    const models: T[] = [];
    for (const attributes of records) {
      models.push(await (this.model as any).create(attributes));
    }
    return this.amount === 1 ? models[0] : models;
  }

  raw(overrides: ModelAttributeInput<T> = {}): ModelAttributeInput<T> | ModelAttributeInput<T>[] {
    const records = Array.from({ length: this.amount }, (_, index) => this.attributesFor(index + 1, overrides));
    return this.amount === 1 ? records[0] : records;
  }

  private attributesFor(sequence: number, overrides: ModelAttributeInput<T>): ModelAttributeInput<T> {
    let attributes: ModelAttributeInput<T> = { ...this.definition(sequence) };
    for (const state of this.states) {
      const next = typeof state === "function" ? state(attributes, sequence) : state;
      attributes = { ...attributes, ...next };
    }
    return { ...attributes, ...overrides };
  }

  private clone(): Factory<T> {
    const next = new Factory(this.model, this.definition);
    next.amount = this.amount;
    next.states = [...this.states];
    return next;
  }
}

export function factory<T extends Model>(
  model: ModelConstructor<T>,
  definition: FactoryDefinition<T>
): Factory<T> {
  return new Factory(model, definition);
}
