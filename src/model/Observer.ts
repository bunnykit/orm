import type { Model } from "./Model.js";

export interface ObserverContract<T extends Model<any> = Model<any>> {
  creating?(model: T): Promise<void> | void;
  created?(model: T): Promise<void> | void;
  updating?(model: T): Promise<void> | void;
  updated?(model: T): Promise<void> | void;
  saving?(model: T): Promise<void> | void;
  saved?(model: T): Promise<void> | void;
  deleting?(model: T): Promise<void> | void;
  deleted?(model: T): Promise<void> | void;
  restoring?(model: T): Promise<void> | void;
  restored?(model: T): Promise<void> | void;
}

export class ObserverRegistry {
  private static observers = new Map<typeof Model, ObserverContract[]>();

  static register(modelClass: typeof Model, observer: ObserverContract): void {
    if (!this.observers.has(modelClass)) {
      this.observers.set(modelClass, []);
    }
    this.observers.get(modelClass)!.push(observer);
  }

  static get(modelClass: typeof Model): ObserverContract[] {
    return this.observers.get(modelClass) || [];
  }

  static async dispatch<T extends Model<any>>(event: keyof ObserverContract, model: T): Promise<void> {
    const observers = this.get(Object.getPrototypeOf(model).constructor as typeof Model);
    for (const observer of observers) {
      const handler = observer[event];
      if (handler) {
        await handler(model);
      }
    }
  }
}
