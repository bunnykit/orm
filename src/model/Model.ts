import { Connection } from "../connection/Connection.js";
import { Builder } from "../query/Builder.js";
import { snakeCase } from "../utils.js";
import { ObserverRegistry } from "./Observer.js";
import { MorphMap } from "./MorphMap.js";
import { MorphTo, MorphOne, MorphMany, MorphToMany } from "./MorphRelations.js";
import { BelongsToMany } from "./BelongsToMany.js";
import { Schema } from "../schema/Schema.js";
import { ModelNotFoundError } from "./ModelNotFoundError.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { IdentityMap } from "./IdentityMap.js";
import { Collection } from "../support/Collection.js";

export type ModelConstructor<T = Model> = (new (...args: any[]) => T) & Omit<typeof Model, "prototype">;
export type GlobalScope = (builder: Builder<any>, model: ModelConstructor) => void;
export type LiteralUnion<T extends string> = T | (string & {});
export type EagerLoadConstraint = (query: Builder<any>) => void | Builder<any>;
export interface EagerLoadDefinition {
  name: string;
  constraint?: EagerLoadConstraint;
}
export type EagerLoadInput =
  | string
  | EagerLoadDefinition
  | Record<string, EagerLoadConstraint | undefined>;
type BaseModelInstanceKey =
  | "$attributes"
  | "$original"
  | "$changes"
  | "$exists"
  | "$relations"
  | "$casts"
  | "$castCache"
  | "$connection"
  | "$hidden"
  | "$visible"
  | "$wasRecentlyCreated"
  | "fill"
  | "setConnection"
  | "getConnection"
  | "isFillable"
  | "getAttribute"
  | "setAttribute"
  | "castAttribute"
  | "serializeCastAttribute"
  | "mergeCasts"
  | "getDirty"
  | "isDirty"
  | "wasChanged"
  | "getChanges"
  | "getOriginal"
  | "replicate"
  | "makeHidden"
  | "makeVisible"
  | "save"
  | "update"
  | "updateTimestamps"
  | "touch"
  | "increment"
  | "decrement"
  | "is"
  | "isNot"
  | "load"
  | "delete"
  | "saveQuietly"
  | "deleteQuietly"
  | "restore"
  | "forceDelete"
  | "refresh"
  | "toJSON"
  | "json"
  | "toString"
  | "freshTimestamp"
  | "setRelation"
  | "getRelation"
  | "hasMany"
  | "belongsTo"
  | "hasOne"
  | "hasManyThrough"
  | "hasOneThrough"
  | "belongsToMany"
  | "morphTo"
  | "morphOne"
  | "morphMany"
  | "morphToMany"
  | "morphedByMany";
export type ModelInstanceAttributeKeys<T> = Extract<Exclude<keyof T, BaseModelInstanceKey>, string>;
export type ModelAttributes<T> = T extends { $attributes: Record<string, any> }
  ? string extends keyof T["$attributes"]
    ? Pick<T, ModelInstanceAttributeKeys<T>>
    : T["$attributes"]
  : T;
export type ModelColumn<T> = LiteralUnion<Extract<keyof ModelAttributes<T>, string>>;
export type ModelColumnValue<T, K> = K extends keyof ModelAttributes<T> ? ModelAttributes<T>[K] : any;
export type ModelAttributeInput<T> = Partial<ModelAttributes<T>> & Record<string, any>;
export interface BulkModelOptions {
  chunkSize?: number;
  events?: boolean;
}
export interface SaveOptions {
  events?: boolean;
}
export type ModelRelationValue =
  | Relation<any>
  | MorphTo<any>
  | MorphOne<any>
  | MorphMany<any>
  | MorphToMany<any>
  | BelongsToMany<any>;
export type ModelRelationName<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey>]-?: T[K] extends (...args: any[]) => ModelRelationValue ? K : never;
}[Exclude<keyof T, BaseModelInstanceKey>], string>;
type RelationReturnModel<F> =
  F extends (...args: any[]) => BelongsToMany<infer R> ? R
  : F extends (...args: any[]) => MorphToMany<infer R> ? R
  : F extends (...args: any[]) => Relation<infer R> ? R
  : Model;
export type RelationRelatedModel<T, R extends string> =
  R extends keyof T
    ? T[R] extends (...args: any[]) => ModelRelationValue
      ? RelationReturnModel<T[R]>
      : Model
    : Model;
type RelationReturnType<F> =
  F extends (...args: any[]) => infer R ? R : never;
type PrevDepth = [never, 0, 1, 2, 3];
type IsSameType<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
export type NestedRelationPath<T, D extends number = 3> = [D] extends [0] ? never : {
  [K in Exclude<keyof T, BaseModelInstanceKey>]: T[K] extends (...args: any[]) => ModelRelationValue
    ? K extends string
      ? IsSameType<RelationReturnModel<T[K]>, T> extends true
        ? K
        : K | `${K}.${string & NestedRelationPath<RelationReturnModel<T[K]>, PrevDepth[D]>}`
      : never
    : never;
}[Exclude<keyof T, BaseModelInstanceKey>];
type PathToModel<T, Path extends string> =
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? T[Head] extends (...args: any[]) => ModelRelationValue
        ? PathToModel<RelationReturnModel<T[Head]>, Tail>
        : never
      : never
    : Path extends keyof T
      ? T[Path] extends (...args: any[]) => ModelRelationValue
        ? RelationReturnModel<T[Path]>
        : never
      : never;
export interface PivotQueryBuilder {
  wherePivot(column: string, operator: string | any, value?: any): any;
  orWherePivot(column: string, operator: string | any, value?: any): any;
  wherePivotIn(column: string, values: any[]): any;
  wherePivotNull(column: string): any;
}
type RelationInstanceAtPath<T, Path extends string> =
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? T[Head] extends (...args: any[]) => ModelRelationValue
        ? RelationInstanceAtPath<RelationReturnModel<T[Head]>, Tail>
        : never
      : never
    : Path extends keyof T
      ? T[Path] extends (...args: any[]) => ModelRelationValue
        ? RelationReturnType<T[Path]>
        : never
      : never;
type PivotRelationValue = BelongsToMany<any> | MorphToMany<any>;
export type RelationConstraintQuery<T, P extends string> =
  Builder<PathToModel<T, P>> &
  (RelationInstanceAtPath<T, P> extends PivotRelationValue ? PivotQueryBuilder : {});
export type TypedConstraintCallback<T, P extends string> = (query: RelationConstraintQuery<T, P>) => void | Builder<any> | RelationConstraintQuery<T, P>;
export type TypedConstraintMap<T> = Partial<{
  [P in NestedRelationPath<T>]: TypedConstraintCallback<T, P>;
}>;
export type TypedConstraintSelection<T, K extends string & NestedRelationPath<T>> = {
  [P in K]: TypedConstraintCallback<T, P>;
};
export type ExistsRelationPath<T> = NestedRelationPath<T> | `${NestedRelationPath<T>} as ${string}`;
type RelationPathFromExistsKey<Key extends string> = Key extends `${infer Relation} as ${string}` ? Relation : Key;
export type TypedExistsConstraintMap<T> = Partial<{
  [K in ExistsRelationPath<T>]: TypedConstraintCallback<T, RelationPathFromExistsKey<K> & NestedRelationPath<T>>;
}>;
export type TypedEagerLoad<T> =
  | LiteralUnion<string & NestedRelationPath<T>>
  | { name: LiteralUnion<string & NestedRelationPath<T>>; constraint?: EagerLoadConstraint }
  | TypedConstraintMap<T>;
type LoadedRelationType<F> =
  F extends (...args: any[]) => HasMany<infer R> ? Collection<R>
  : F extends (...args: any[]) => HasOne<infer R> ? R | null
  : F extends (...args: any[]) => BelongsTo<infer R> ? R | null
  : F extends (...args: any[]) => BelongsToMany<infer R> ? Collection<R>
  : F extends (...args: any[]) => MorphMany<infer R> ? Collection<R>
  : F extends (...args: any[]) => MorphOne<infer R> ? R | null
  : F extends (...args: any[]) => MorphToMany<infer R> ? Collection<R>
  : F extends (...args: any[]) => Relation<infer R> ? Collection<R> | R
  : unknown;
// Like LoadedRelationType but accepts a custom element type (for nested constraint maps)
type LoadedTypeWithNested<F, ElemType> =
  F extends (...args: any[]) => HasMany<any> ? Collection<ElemType>
  : F extends (...args: any[]) => HasOne<any> ? ElemType | null
  : F extends (...args: any[]) => BelongsTo<any> ? ElemType | null
  : F extends (...args: any[]) => BelongsToMany<any> ? Collection<ElemType>
  : F extends (...args: any[]) => MorphMany<any> ? Collection<ElemType>
  : F extends (...args: any[]) => MorphOne<any> ? ElemType | null
  : F extends (...args: any[]) => MorphToMany<any> ? Collection<ElemType>
  : unknown;
// Extract the raw related model from a relation method
type RelModelOf<F> =
  F extends (...args: any[]) => HasMany<infer R> ? R
  : F extends (...args: any[]) => HasOne<infer R> ? R
  : F extends (...args: any[]) => BelongsTo<infer R> ? R
  : F extends (...args: any[]) => BelongsToMany<infer R> ? R
  : F extends (...args: any[]) => MorphMany<infer R> ? R
  : F extends (...args: any[]) => MorphOne<infer R> ? R
  : F extends (...args: any[]) => MorphToMany<infer R> ? R
  : unknown;
// Extract TResult from a constraint callback's Builder return type, or fall back
type CallbackResultModel<CB, Fallback> =
  NonNullable<CB> extends (...args: any[]) => Builder<any, infer TResult> ? TResult : Fallback;
type TopLevelKey<S extends string> = S extends `${infer Head}.${string}` ? Head : S;
export type ExtractStringPaths<R> =
  R extends string ? R
  : R extends ReadonlyArray<infer Item> ? ExtractStringPaths<Item>
  : R extends object ? keyof R & string
  : never;
type WithJsonMethods<T> = Omit<T, "json" | "toJSON"> & {
  toJSON(): ModelJson<Omit<T, "json" | "toJSON">>;
  json(options?: { relations?: boolean }): ModelJson<Omit<T, "json" | "toJSON">>;
};
type WithLoadedRelationsShape<T, Paths extends string> =
  Omit<T, TopLevelKey<Paths> & keyof T> & {
    [K in TopLevelKey<Paths> & keyof T]: T[K] extends (...args: any[]) => ModelRelationValue
      ? LoadedRelationType<T[K]>
      : T[K];
  };
export type WithLoadedRelations<T, Paths extends string> = WithJsonMethods<WithLoadedRelationsShape<T, Paths>>;
export type WithRelationCount<T, RelationName extends string, Alias extends string | undefined = undefined> =
  WithJsonMethods<T & {
    [K in Alias extends string ? Alias : `${RelationName}_count`]: number;
  }>;
export type WithRelationExists<T, RelationName extends string, Alias extends string | undefined = undefined> =
  WithJsonMethods<T & {
    [K in Alias extends string ? Alias : `${RelationName}_exists`]: boolean;
  }>;
type RelationExistsAlias<Key extends string> = Key extends `${string} as ${infer Alias}` ? Alias : `${Key}_exists`;
export type WithRelationExistsMap<T, R extends object> =
  WithJsonMethods<T & {
    [K in keyof R & string as RelationExistsAlias<K>]: boolean;
  }>;
type AggregateConstraint<T, R extends string> = TypedConstraintCallback<T, R & NestedRelationPath<T>>;
type AggregateColumn<T, R extends string> = ModelColumn<RelationRelatedModel<T, R>>;
// Variant of WithLoadedRelations for constraint map form — preserves nested loaded types
// from each callback's Builder return type instead of using the raw relation model.
type WithLoadedRelationsFromConstraintMapShape<T, R extends object> =
  Omit<T, keyof R & keyof T> & {
    [K in keyof R & keyof T & string]: T[K] extends (...args: any[]) => ModelRelationValue
      ? LoadedTypeWithNested<T[K], CallbackResultModel<R[K], RelModelOf<T[K]>>>
      : T[K];
  };
export type WithLoadedRelationsFromConstraintMap<T, R extends object> = WithJsonMethods<WithLoadedRelationsFromConstraintMapShape<T, R>>;
type JsonRelationKeys<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey | keyof ModelAttributes<T>>]-?:
    T[K] extends (...args: any[]) => any ? never
    : NonNullable<T[K]> extends Collection<any> ? K
    : NonNullable<T[K]> extends { $attributes: Record<string, any> } ? K
    : never;
}[Exclude<keyof T, BaseModelInstanceKey | keyof ModelAttributes<T>>], string>;
type JsonExtraKeys<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey | keyof ModelAttributes<T>>]-?:
    T[K] extends (...args: any[]) => any ? never
    : NonNullable<T[K]> extends Collection<any> ? never
    : NonNullable<T[K]> extends { $attributes: Record<string, any> } ? never
    : K;
}[Exclude<keyof T, BaseModelInstanceKey | keyof ModelAttributes<T>>], string>;
type JsonRelationValue<T> =
  T extends Collection<infer R> ? ModelJson<R>[]
  : T extends { $attributes: Record<string, any> } ? ModelJson<T>
  : T;
export type ModelJson<T> =
  ModelAttributes<T> &
  {
    [K in JsonRelationKeys<T>]: JsonRelationValue<T[K]>;
  } &
  {
    [K in JsonExtraKeys<T>]: T[K];
  };
export type CastDefinition =
  | string
  | CastsAttributes
  | (new (...args: any[]) => CastsAttributes);

export interface CastsAttributes {
  get(model: Model, key: string, value: any, attributes: Record<string, any>): any;
  set(model: Model, key: string, value: any, attributes: Record<string, any>): any;
}

type BivariantCallback<TArgs extends any[], TResult> = {
  bivarianceHack(...args: TArgs): TResult;
}["bivarianceHack"];

export interface AttributeDefinition<TAttributes extends Record<string, any> = Record<string, any>> {
  get?: BivariantCallback<[value: any, attributes: TAttributes, model: Model<any>], any>;
  set?: BivariantCallback<[value: any, attributes: TAttributes, model: Model<any>], any>;
}

export type AccessorMap<TAttributes extends Record<string, any> = Record<string, any>> = Record<string, AttributeDefinition<TAttributes>>;

function getAccessors(target: Model<any>): AccessorMap {
  return (Object.getPrototypeOf(target).constructor as any).accessors || {};
}

const modelProxyHandler: ProxyHandler<Model<any>> = {
  get(target, prop, receiver) {
    if (typeof prop === "string") {
      const accessors = getAccessors(target);
      if (prop in accessors && accessors[prop].get) {
        return accessors[prop].get!((target.$attributes as any)[prop], target.$attributes as any, target);
      }
      if (prop in target.$relations) return target.$relations[prop];
      if (!(prop in target) && prop in target.$attributes) return target.getAttribute(prop);
    }
    return Reflect.get(target, prop, receiver);
  },
  set(target, prop, value, receiver) {
    if (typeof prop === "string" && !prop.startsWith("$") && !(prop in target)) {
      const accessors = getAccessors(target);
      if (prop in accessors && accessors[prop].set) {
        (target.$attributes as any)[prop] = accessors[prop].set!(value, target.$attributes as any, target);
        delete target.$castCache[prop];
        return true;
      }
      target.setAttribute(prop, value);
      return true;
    }
    return Reflect.set(target, prop, value, receiver);
  },
  has(target, prop) {
    if (typeof prop === "string" && prop in target.$relations) return true;
    if (typeof prop === "string" && prop in target.$attributes) return true;
    if (typeof prop === "string" && prop in getAccessors(target)) return true;
    return Reflect.has(target, prop);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === "string" && prop in target.$relations) {
      return { enumerable: true, configurable: true, value: target.$relations[prop] };
    }
    if (typeof prop === "string" && prop in getAccessors(target) && getAccessors(target)[prop].get) {
      const acc = getAccessors(target)[prop];
      return { enumerable: true, configurable: true, value: acc.get!((target.$attributes as any)[prop], target.$attributes as any, target) };
    }
    if (typeof prop === "string" && prop in target.$attributes) {
      return { enumerable: true, configurable: true, value: target.getAttribute(prop) };
    }
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
  ownKeys(target) {
    const keys = new Set(Reflect.ownKeys(target) as string[]);
    for (const key of Object.keys(target.$relations)) {
      if (!key.startsWith("$")) keys.add(key);
    }
    for (const key of Object.keys(getAccessors(target))) {
      keys.add(key);
    }
    for (const key of Object.keys(target.$attributes)) {
      if (!key.startsWith("$")) keys.add(key);
    }
    return Array.from(keys);
  },
};

const globalScopes = new WeakMap<ModelConstructor, Map<string, GlobalScope>>();

function getGlobalScopes(model: ModelConstructor): Map<string, GlobalScope> {
  const scopes = new Map<string, GlobalScope>();
  const chain: ModelConstructor[] = [];
  let current: any = model;
  while (current && current.prototype instanceof Model) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }
  for (const item of chain) {
    const ownScopes = globalScopes.get(item);
    if (ownScopes) {
      for (const [name, scope] of ownScopes) scopes.set(name, scope);
    }
  }
  return scopes;
}

export function findRelationMethod(model: Model | ModelConstructor, relationName: string): Function | null {
  let current = model instanceof Model ? Object.getPrototypeOf(model) : model.prototype;
  while (current && current !== Model.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, relationName);
    if (typeof descriptor?.value === "function") {
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  const descriptor = Object.getOwnPropertyDescriptor(Model.prototype, relationName);
  return typeof descriptor?.value === "function" ? descriptor.value : null;
}

function getModelConstructor(model: Model): typeof Model {
  return Object.getPrototypeOf(model).constructor as typeof Model;
}

export abstract class Relation<T extends Model = Model> {
  protected builder: Builder<T>;
  protected parent: Model;
  protected related: ModelConstructor;
  protected foreignKey: string;
  protected localKey: string;

  constructor(parent: Model, related: ModelConstructor, foreignKey?: string, localKey?: string) {
    this.parent = parent;
    this.related = related;
    this.builder = (related as any).on(parent.getConnection());
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.localKey = localKey || related.primaryKey;

    // Wrap getResults with lazy-loading guard
    const originalGetResults = (this as any).getResults.bind(this);
    (this as any).getResults = async () => {
      const parentConstructor = getModelConstructor(this.parent);
      if (parentConstructor.preventLazyLoading) {
        throw new Error(
          `Lazy loading is prevented on ${parentConstructor.name}. ` +
            `Eager load the relation using with().`
        );
      }
      return await originalGetResults();
    };
  }

  abstract addConstraints(): void;
  abstract getResults(): Promise<T | Collection<T> | null>;
  get(): Promise<T | Collection<T> | null> { return this.getResults(); }
  abstract addEagerConstraints(models: Model[]): void;
  abstract getEager(): Promise<Collection<any>>;
  abstract match(models: Model[], results: Collection<any>, relationName: string): void;

  protected defaultForeignKey(): string {
    return `${snakeCase(getModelConstructor(this.parent).name)}_id`;
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getTable()}.${column}`;
  }

  protected newExistenceQuery(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(parentQuery.connection).select(aggregate);
    query.whereColumn(`${this.related.getTable()}.${this.foreignKey}`, "=", `${parentQuery.tableName}.${this.localKey}`);
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery, "1", callback).toSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery, aggregate, callback).toSql();
  }
}

export class HasMany<T extends Model = Model> extends Relation<T> {
  constructor(parent: Model, related: ModelConstructor, foreignKey?: string, localKey?: string) {
    super(parent, related, foreignKey, localKey);
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.addConstraints();
  }

  async saveMany(models: T[]): Promise<T[]> {
    for (const model of models) {
      model.setAttribute(this.foreignKey as any, this.parent.getAttribute(this.localKey));
      await model.save();
    }
    return models;
  }

  async create(attributes: Record<string, any>): Promise<T> {
    const instance = new (this.related as any)({
      ...attributes,
      [this.foreignKey]: this.parent.getAttribute(this.localKey),
    }) as T;
    await instance.save();
    return instance;
  }

  async createMany(records: Record<string, any>[]): Promise<T[]> {
    const models: T[] = [];
    for (const record of records) {
      const instance = new (this.related as any)({
        ...record,
        [this.foreignKey]: this.parent.getAttribute(this.localKey),
      }) as T;
      await instance.save();
      models.push(instance);
    }
    return models;
  }

  addConstraints(): void {
    const parentValue = this.parent.getAttribute(this.localKey);
    this.builder.where(this.foreignKey, parentValue);
  }

  addEagerConstraints(models: Model[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey));
    this.builder.whereIn(this.foreignKey, keys);
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignKey];
      if (!dictionary[key]) dictionary[key] = [];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, new Collection(dictionary[String(key)] || []));
    }
  }

  async getResults(): Promise<Collection<T>> {
    return this.builder.get();
  }

  latestOfMany(column: string = (this.related as typeof Model).primaryKey): HasOne<T> {
    return this.ofMany(column, "max");
  }

  oldestOfMany(column: string = (this.related as typeof Model).primaryKey): HasOne<T> {
    return this.ofMany(column, "min");
  }

  ofMany(column: string, aggregate: "max" | "min" = "max"): HasOne<T> {
    const relation = new HasOne<T>(this.parent, this.related, this.foreignKey, this.localKey);
    relation.getQuery().orderBy(column, aggregate === "max" ? "desc" : "asc");
    return relation;
  }
}

export class BelongsTo<T extends Model = Model> extends Relation<T> {
  private defaultAttributes?: Record<string, any>;

  constructor(parent: Model, related: ModelConstructor, foreignKey?: string, ownerKey?: string) {
    super(parent, related, foreignKey, ownerKey);
    this.foreignKey = foreignKey || `${snakeCase(related.name)}_id`;
    this.localKey = ownerKey || related.primaryKey;
    this.addConstraints();
  }

  withDefault(attributes: Record<string, any> = {}): this {
    this.defaultAttributes = attributes;
    return this;
  }

  addConstraints(): void {
    const childValue = this.parent.getAttribute(this.foreignKey);
    this.builder.where(this.localKey, childValue);
  }

  addEagerConstraints(models: Model[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.foreignKey));
    this.builder.whereIn(this.localKey, keys);
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.localKey];
      dictionary[String(key)] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.foreignKey);
      const found = dictionary[String(key)] ?? null;
      model.setRelation(relationName, found ?? this.makeDefault());
    }
  }

  async getResults(): Promise<T | null> {
    const result = await this.builder.first();
    return result ?? (this.makeDefault() as T | null);
  }

  private makeDefault(): T | null {
    if (this.defaultAttributes === undefined) return null;
    const instance = new (this.related as any)() as T;
    if (Object.keys(this.defaultAttributes).length > 0) instance.fill(this.defaultAttributes as any);
    return instance;
  }

  associate(model: Model | any): Model {
    const value = model instanceof Model ? model.getAttribute(this.localKey) : model;
    this.parent.setAttribute(this.foreignKey, value);
    return this.parent;
  }

  dissociate(): Model {
    this.parent.setAttribute(this.foreignKey, null);
    return this.parent;
  }

  protected newExistenceQuery(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(parentQuery.connection).select(aggregate);
    query.whereColumn(`${this.related.getTable()}.${this.localKey}`, "=", `${parentQuery.tableName}.${this.foreignKey}`);
    if (callback) callback(query);
    return query;
  }
}

export class HasManyThrough<T extends Model = Model> extends Relation<T> {
  protected through: ModelConstructor;
  protected firstKey: string;
  protected secondKey: string;
  protected secondLocalKey: string;

  constructor(
    parent: Model,
    related: ModelConstructor,
    through: ModelConstructor,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string
  ) {
    super(parent, related, secondKey, localKey);
    const parentConstructor = getModelConstructor(parent);
    this.through = through;
    this.localKey = localKey || parentConstructor.primaryKey;
    this.firstKey = firstKey || `${snakeCase(parentConstructor.name)}_id`;
    this.secondKey = secondKey || `${snakeCase(through.name)}_id`;
    this.secondLocalKey = secondLocalKey || through.primaryKey;
    this.addConstraints();
  }

  protected qualifiedThroughTable(): string {
    return this.parent.getConnection().qualifyTable(this.through.getTable());
  }

  addConstraints(): void {
    const throughTable = this.through.getTable();
    const relatedTable = this.related.getTable();
    this.builder.select(`${relatedTable}.*`);
    this.builder.join(
      this.qualifiedThroughTable(),
      `${throughTable}.${this.secondLocalKey}`,
      "=",
      `${relatedTable}.${this.secondKey}`
    );
    this.builder.where(`${throughTable}.${this.firstKey}`, this.parent.getAttribute(this.localKey));
  }

  addEagerConstraints(models: Model[]): void {
    const throughTable = this.through.getTable();
    const relatedTable = this.related.getTable();
    const keys = models.map((m) => m.getAttribute(this.localKey));
    this.builder = (this.related as any).on(this.parent.getConnection());
    this.builder.select(`${relatedTable}.*`, `${throughTable}.${this.firstKey}`);
    this.builder.join(
      this.qualifiedThroughTable(),
      `${throughTable}.${this.secondLocalKey}`,
      "=",
      `${relatedTable}.${this.secondKey}`
    );
    this.builder.whereIn(`${throughTable}.${this.firstKey}`, keys);
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.firstKey];
      if (!dictionary[key]) dictionary[key] = [];
      delete (result.$attributes as any)[this.firstKey];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, new Collection(dictionary[String(key)] || []));
    }
  }

  async getResults(): Promise<Collection<T> | T | null> {
    return this.builder.get();
  }

  protected newExistenceQuery(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const throughTable = this.through.getTable();
    const relatedTable = this.related.getTable();
    const query = (this.related as any).on(parentQuery.connection).select(aggregate);
    query.join(
      parentQuery.connection.qualifyTable(throughTable),
      `${throughTable}.${this.secondLocalKey}`,
      "=",
      `${relatedTable}.${this.secondKey}`
    );
    query.whereColumn(`${throughTable}.${this.firstKey}`, "=", `${parentQuery.tableName}.${this.localKey}`);
    if (callback) callback(query);
    return query;
  }
}

export class HasOneThrough<T extends Model = Model> extends HasManyThrough<T> {
  async getResults(): Promise<T | null> {
    return this.builder.first();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.firstKey];
      delete (result.$attributes as any)[this.firstKey];
      if (!dictionary[key]) dictionary[key] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, dictionary[String(key)] || null);
    }
  }
}

export class HasOne<T extends Model = Model> extends Relation<T> {
  private defaultAttributes?: Record<string, any>;

  constructor(parent: Model, related: ModelConstructor, foreignKey?: string, localKey?: string) {
    super(parent, related, foreignKey, localKey);
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.addConstraints();
  }

  withDefault(attributes: Record<string, any> = {}): this {
    this.defaultAttributes = attributes;
    return this;
  }

  private makeDefault(): T | null {
    if (this.defaultAttributes === undefined) return null;
    const instance = new (this.related as any)() as T;
    if (Object.keys(this.defaultAttributes).length > 0) instance.fill(this.defaultAttributes as any);
    return instance;
  }

  addConstraints(): void {
    const parentValue = this.parent.getAttribute(this.localKey);
    this.builder.where(this.foreignKey, parentValue);
  }

  addEagerConstraints(models: Model[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey));
    this.builder.whereIn(this.foreignKey, keys);
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignKey];
      dictionary[String(key)] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      const found = dictionary[String(key)] ?? null;
      model.setRelation(relationName, found ?? this.makeDefault());
    }
  }

  async getResults(): Promise<T | null> {
    const result = await this.builder.first();
    return result ?? (this.makeDefault() as T | null);
  }
}

export class Model<T extends Record<string, any> = any> {
  static table: string;
  static primaryKey = "id";
  static timestamps = true;
  static connection?: Connection;
  static dateFormat = "YYYY-MM-DD HH:mm:ss";
  static keyType: "int" | "string" | "uuid" = "int";
  static incrementing = true;
  static usesUuids = false;
  static morphName?: string;
  static casts: Record<string, CastDefinition> = {};
  static fillable: string[] = [];
  static guarded: string[] = [];
  static attributes: Record<string, any> = {};
  static softDeletes = false;
  static deletedAtColumn = "deleted_at";
  static preventLazyLoading = false;
  static hidden: string[] = [];
  static visible: string[] = [];
  static accessors: AccessorMap = {};
  static touches: string[] = [];

  $attributes = {} as T;
  $original = {} as Partial<T>;
  $changes = {} as Partial<T>;
  $exists = false;
  $relations: Record<string, any> = {};
  $casts: Record<string, CastDefinition> = {};
  $castCache: Record<string, any> = {};
  $connection?: Connection;
  $hidden: string[] = [];
  $visible: string[] = [];
  $wasRecentlyCreated = false;

  constructor(attributes?: Partial<T>) {
    const defaults = (Object.getPrototypeOf(this).constructor as typeof Model).attributes || {};
    if (Object.keys(defaults).length > 0) {
      this.fill({ ...defaults } as Partial<T>);
    }
    if (attributes) {
      this.fill(attributes);
    }
    return new Proxy(this, modelProxyHandler);
  }

  static define<A extends Record<string, any>>(tableName: string, modelName?: string): (new (attributes?: Partial<A>) => Model<A> & A) & Omit<typeof Model, "new"> {
    const name = modelName || tableName
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("")
      .replace(/s$/, "");
    const Base = class extends (this as unknown as typeof Model)<A> {
      static override table = tableName;
    };
    Object.defineProperty(Base, "name", { value: name, writable: false, configurable: true });
    return Base as unknown as ModelConstructor<Model<A> & A>;
  }

  static getTable(): string {
    return this.table || snakeCase(this.name) + "s";
  }

  static getConnection(): Connection {
    const tenantConnection = TenantContext.current()?.connection;
    const ownConnection = Object.prototype.hasOwnProperty.call(this, "connection") ? this.connection : undefined;
    const connection = tenantConnection || ownConnection || this.connection || ConnectionManager.getDefault();
    if (!connection) {
      throw new Error(`No connection set on model ${this.name}`);
    }
    return connection;
  }

  static setConnection(connection: Connection): void {
    this.connection = connection;
    ConnectionManager.setDefault(connection);
  }

  static useIdentityMap<T>(callback: () => T | Promise<T>): Promise<T> {
    return IdentityMap.run(callback);
  }

  static on<M extends ModelConstructor>(this: M, connection: string | Connection): Builder<InstanceType<M>> {
    const resolved = typeof connection === "string" ? ConnectionManager.require(connection) : connection;
    const builder = new Builder<InstanceType<M>>(resolved, resolved.qualifyTable(this.getTable()));
    builder.setModel(this);
    this.applyGlobalScopes(builder);
    return builder;
  }

  static forTenant<M extends ModelConstructor>(this: M, tenantId: string): Builder<InstanceType<M>> {
    const context = ConnectionManager.getResolvedTenant(tenantId);
    if (!context) {
      throw new Error(`Tenant "${tenantId}" has not been resolved. Use TenantContext.run() or await ConnectionManager.resolveTenant() first.`);
    }
    return this.on(context.connection);
  }

  static query<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    const connection = this.getConnection();
    const builder = new Builder<InstanceType<M>>(connection, connection.qualifyTable(this.getTable()));
    builder.setModel(this);
    this.applyGlobalScopes(builder);
    return builder;
  }

  static addGlobalScope(name: string, scope: GlobalScope): void {
    const scopes = globalScopes.get(this) || new Map<string, GlobalScope>();
    scopes.set(name, scope);
    globalScopes.set(this, scopes);
  }

  static removeGlobalScope(name: string): void {
    globalScopes.get(this)?.delete(name);
  }

  static applyGlobalScopes(builder: Builder<any>): void {
    if (this.softDeletes) {
      builder.whereNull(this.getQualifiedDeletedAtColumn(), "and", "softDeletes");
    }
    for (const [name, scope] of getGlobalScopes(this)) {
      scope(builder, this);
      for (const where of builder.wheres) {
        if (!where.scope) where.scope = name;
      }
    }
  }

  static getQualifiedDeletedAtColumn(): string {
    return `${this.getTable()}.${this.deletedAtColumn}`;
  }

  static async shouldAutoGeneratePrimaryKey(): Promise<boolean> {
    if ((this as any).usesUuids || this.keyType === "uuid") return true;
    const column = await Schema.getColumn(this.getTable(), this.primaryKey);
    if (!column) return false;
    if (!column.primary) return false;
    if (column.autoIncrement) return false;
    const type = String(column.type || "").toLowerCase();
    const numericTypes = new Set(["integer", "int", "bigint", "smallint", "tinyint", "real", "float", "double", "decimal", "numeric"]);
    return !numericTypes.has(type);
  }

  static async prepareBulkRecords<M extends ModelConstructor>(
    this: M,
    records: ModelAttributeInput<InstanceType<M>>[]
  ): Promise<Record<string, any>[]> {
    const generatePk = await this.shouldAutoGeneratePrimaryKey();
    const now = this.timestamps ? new Date().toISOString() : null;
    const prepared: Record<string, any>[] = [];

    for (const record of records) {
      const instance = new this() as InstanceType<M>;
      instance.fill(record as any);
      const attributes = { ...(instance.$attributes as Record<string, any>) };

      if (now) {
        if (attributes.created_at === undefined) attributes.created_at = now;
        if (attributes.updated_at === undefined) attributes.updated_at = now;
      }

      if (generatePk) {
        const pk = this.primaryKey;
        const pkValue = attributes[pk];
        if (pkValue === null || pkValue === undefined || pkValue === "") {
          attributes[pk] = crypto.randomUUID();
        }
      }

      prepared.push(attributes);
    }
    return prepared;
  }

  static async prepareBulkRecord<M extends ModelConstructor>(
    this: M,
    record: ModelAttributeInput<InstanceType<M>>,
    options: { touchCreatedAt?: boolean; touchUpdatedAt?: boolean; generatePrimaryKey?: boolean } = {}
  ): Promise<Record<string, any>> {
    const instance = new this() as InstanceType<M>;
    instance.fill(record as any);
    const attributes = { ...(instance.$attributes as Record<string, any>) };

    if (this.timestamps) {
      const now = instance.freshTimestamp();
      if (options.touchCreatedAt !== false && attributes.created_at === undefined) attributes.created_at = now;
      if (options.touchUpdatedAt !== false && attributes.updated_at === undefined) attributes.updated_at = now;
    }

    if (options.generatePrimaryKey !== false) {
      const primaryKey = this.primaryKey;
      const primaryKeyValue = attributes[primaryKey];
      if ((primaryKeyValue === null || primaryKeyValue === undefined || primaryKeyValue === "") && await this.shouldAutoGeneratePrimaryKey()) {
        attributes[primaryKey] = crypto.randomUUID();
      }
    }

    return attributes;
  }

  static hydrate<M extends ModelConstructor>(
    this: M,
    row: Record<string, any>,
    connection?: Connection
  ): InstanceType<M> {
    const instance = new this() as InstanceType<M>;
    instance.$attributes = { ...(instance.$attributes as Record<string, any>), ...row } as any;
    instance.$original = { ...row } as any;
    instance.$castCache = {};
    instance.$exists = true;
    if (connection) {
      instance.setConnection(connection);
    }
    return instance;
  }

  static async create<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>>,
    options: SaveOptions = {}
  ): Promise<InstanceType<M>> {
    const instance = new this() as InstanceType<M>;
    instance.fill(attributes as any);
    await instance.save(options);
    return instance;
  }

  static async forceCreate<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>>,
    options: SaveOptions = {}
  ): Promise<InstanceType<M>> {
    const instance = new this() as InstanceType<M>;
    for (const [key, value] of Object.entries(attributes)) {
      instance.setAttribute(key as any, value as any);
    }
    await instance.save(options);
    return instance;
  }

  static async truncate<M extends ModelConstructor>(this: M): Promise<void> {
    const connection = this.getConnection();
    await connection.run(`DELETE FROM ${connection.qualifyTable(this.getTable())}`);
  }

  static async withoutTimestamps<M extends ModelConstructor, R>(this: M, callback: () => Promise<R>): Promise<R> {
    const original = this.timestamps;
    (this as any).timestamps = false;
    try {
      return await callback();
    } finally {
      (this as any).timestamps = original;
    }
  }

  static async insert<M extends ModelConstructor>(
    this: M,
    records: ModelAttributeInput<InstanceType<M>> | ModelAttributeInput<InstanceType<M>>[],
    options: Omit<BulkModelOptions, "events"> = {}
  ): Promise<any> {
    const prepared = await this.prepareBulkRecords(Array.isArray(records) ? records : [records]);
    const chunkSize = options.chunkSize || prepared.length || 1;
    let result: any;
    for (let i = 0; i < prepared.length; i += chunkSize) {
      result = await this.query().insert(prepared.slice(i, i + chunkSize) as any);
    }
    return result;
  }

  static async upsert<M extends ModelConstructor>(
    this: M,
    records: ModelAttributeInput<InstanceType<M>> | ModelAttributeInput<InstanceType<M>>[],
    uniqueBy: ModelColumn<InstanceType<M>> | ModelColumn<InstanceType<M>>[],
    updateColumns?: ModelColumn<InstanceType<M>>[],
    options: Omit<BulkModelOptions, "events"> = {}
  ): Promise<any> {
    const prepared = await this.prepareBulkRecords(Array.isArray(records) ? records : [records]);
    const chunkSize = options.chunkSize || prepared.length || 1;
    let columns = updateColumns;
    if (!columns && this.timestamps) {
      const uniqueColumns = new Set(Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy]);
      columns = Object.keys(prepared[0] || {}).filter((column) => column !== "created_at" && !uniqueColumns.has(column as any)) as any;
    }
    let result: any;
    for (let i = 0; i < prepared.length; i += chunkSize) {
      result = await this.query().upsert(prepared.slice(i, i + chunkSize) as any, uniqueBy as any, columns as any);
    }
    return result;
  }

  static async updateOrInsert<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>>,
    values: ModelAttributeInput<InstanceType<M>> = {}
  ): Promise<boolean> {
    const exists = await this.where(attributes).exists();
    if (exists) {
      const update = await this.prepareBulkRecord(values, { touchUpdatedAt: true, touchCreatedAt: false, generatePrimaryKey: false });
      await this.where(attributes).update(update as any);
      return true;
    }
    await this.insert({ ...attributes, ...values } as any);
    return true;
  }

  static async createMany<M extends ModelConstructor>(
    this: M,
    records: ModelAttributeInput<InstanceType<M>>[],
    options: BulkModelOptions = {}
  ): Promise<InstanceType<M>[]> {
    const models = records.map((attributes) => new this(attributes) as InstanceType<M>);
    await this.saveMany(models, options);
    return models;
  }

  static async saveMany<M extends ModelConstructor>(
    this: M,
    models: InstanceType<M>[],
    options: BulkModelOptions = {}
  ): Promise<InstanceType<M>[]> {
    const chunkSize = options.chunkSize || models.length || 1;
    const events = options.events !== false;
    if (events) {
      for (const model of models) {
        await model.save();
      }
      return models;
    }

    for (let i = 0; i < models.length; i += chunkSize) {
      const chunk = models.slice(i, i + chunkSize);
      const newModels = chunk.filter((model) => !model.$exists);
      const existingModels = chunk.filter((model) => model.$exists);

      if (newModels.length > 0) {
        const shouldGeneratePrimaryKey = await this.shouldAutoGeneratePrimaryKey();
        const bulkModels: InstanceType<M>[] = [];
        for (const model of newModels) {
          const pk = model.getAttribute(this.primaryKey);
          if (!shouldGeneratePrimaryKey && (pk === null || pk === undefined || pk === "")) {
            const record = await this.prepareBulkRecord(model.$attributes as any);
            const id = await this.query().insertGetId(record as any);
            if (id) record[this.primaryKey] = id;
            model.$attributes = record as any;
            model.$original = { ...record } as any;
            model.$exists = true;
          } else {
            bulkModels.push(model);
          }
        }

        if (bulkModels.length > 0) {
          const records = await this.prepareBulkRecords(bulkModels.map((model) => model.$attributes as any));
          await this.query().insert(records as any);
          for (let index = 0; index < bulkModels.length; index++) {
            bulkModels[index].$attributes = records[index] as any;
            bulkModels[index].$original = { ...records[index] } as any;
            bulkModels[index].$exists = true;
          }
        }
      }

      for (const model of existingModels) {
        let dirty = model.getDirty();
        if (Object.keys(dirty).length > 0 && this.timestamps) {
          (model.$attributes as any).updated_at = model.freshTimestamp();
          delete model.$castCache.updated_at;
          dirty = model.getDirty();
        }
        if (Object.keys(dirty).length === 0) continue;
        await this.query().where(this.primaryKey, model.getAttribute(this.primaryKey)).update(dirty as any);
        model.$original = { ...model.$attributes };
      }
    }
    return models;
  }

  static async find<M extends ModelConstructor>(this: M, id: any): Promise<InstanceType<M> | null> {
    return this.query().find(id, this.primaryKey);
  }

  static async findOrFail<M extends ModelConstructor>(this: M, id: any): Promise<InstanceType<M>> {
    const result = await this.find(id);
    if (!result) {
      throw new ModelNotFoundError(this.name, id);
    }
    return result;
  }

  static async first<M extends ModelConstructor>(this: M): Promise<InstanceType<M> | null> {
    return this.query().first();
  }

  static async firstOrFail<M extends ModelConstructor>(this: M): Promise<InstanceType<M>> {
    const result = await this.first();
    if (!result) {
      throw new ModelNotFoundError(this.name);
    }
    return result;
  }

  static async firstOrNew<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>> = {},
    values: ModelAttributeInput<InstanceType<M>> = {}
  ): Promise<InstanceType<M>> {
    const found = await this.where(attributes).first();
    if (found) return found;
    return new this({ ...attributes, ...values } as any) as InstanceType<M>;
  }

  static async firstOrCreate<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>> = {},
    values: ModelAttributeInput<InstanceType<M>> = {}
  ): Promise<InstanceType<M>> {
    const found = await this.where(attributes).first();
    if (found) return found;
    return this.create({ ...attributes, ...values } as any);
  }

  static async updateOrCreate<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>>,
    values: ModelAttributeInput<InstanceType<M>> = {}
  ): Promise<InstanceType<M>> {
    const found = await this.where(attributes).first();
    if (found) {
      found.fill(values);
      await found.save();
      return found;
    }
    return this.create({ ...attributes, ...values } as any);
  }

  static where<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator: string, value: any): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: ModelAttributeInput<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | ModelAttributeInput<InstanceType<M>> | ((query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>), operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().where(column as any, operator, value);
  }

  static orderBy<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, direction?: "asc" | "desc"): Builder<InstanceType<M>> {
    return this.query().orderBy(column, direction);
  }

  static whereIn<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, values: ModelColumnValue<InstanceType<M>, K>[]): Builder<InstanceType<M>> {
    return this.query().whereIn(column, values);
  }

  static whereNull<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>): Builder<InstanceType<M>> {
    return this.query().whereNull(column);
  }

  static whereNotNull<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>): Builder<InstanceType<M>> {
    return this.query().whereNotNull(column);
  }

  static orWhere<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator: string, value: any): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: ModelAttributeInput<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | ModelAttributeInput<InstanceType<M>> | ((query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>), operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhere(column as any, operator, value);
  }

  static whereNot<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | ModelAttributeInput<InstanceType<M>>, value?: any): Builder<InstanceType<M>> {
    return this.query().whereNot(column as any, value);
  }

  static orWhereNot<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | ModelAttributeInput<InstanceType<M>>, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhereNot(column as any, value);
  }

  static whereDate<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().whereDate(column, operator, value);
  }

  static orWhereDate<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhereDate(column, operator, value);
  }

  static whereDay<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().whereDay(column, operator, value);
  }

  static orWhereDay<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhereDay(column, operator, value);
  }

  static whereMonth<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().whereMonth(column, operator, value);
  }

  static orWhereMonth<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhereMonth(column, operator, value);
  }

  static whereYear<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().whereYear(column, operator, value);
  }

  static orWhereYear<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhereYear(column, operator, value);
  }

  static whereTime<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().whereTime(column, operator, value);
  }

  static orWhereTime<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhereTime(column, operator, value);
  }

  static latest<M extends ModelConstructor>(this: M, column?: ModelColumn<InstanceType<M>>): Builder<InstanceType<M>> {
    return this.query().latest(column);
  }

  static oldest<M extends ModelConstructor>(this: M, column?: ModelColumn<InstanceType<M>>): Builder<InstanceType<M>> {
    return this.query().oldest(column);
  }

  static when<M extends ModelConstructor>(this: M, condition: any, callback: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>, defaultCallback?: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>> {
    return this.query().when(condition, callback, defaultCallback);
  }

  static unless<M extends ModelConstructor>(this: M, condition: any, callback: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>, defaultCallback?: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>> {
    return this.query().unless(condition, callback, defaultCallback);
  }

  static tap<M extends ModelConstructor>(this: M, callback: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>> {
    return this.query().tap(callback);
  }

  static take<M extends ModelConstructor>(this: M, count: number): Builder<InstanceType<M>> {
    return this.query().take(count);
  }

  static skip<M extends ModelConstructor>(this: M, count: number): Builder<InstanceType<M>> {
    return this.query().skip(count);
  }

  static inRandomOrder<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return this.query().inRandomOrder();
  }

  static lockForUpdate<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return this.query().lockForUpdate();
  }

  static sharedLock<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return this.query().sharedLock();
  }

  static with<M extends ModelConstructor, K extends string & NestedRelationPath<InstanceType<M>>>(this: M, constraint: TypedConstraintSelection<InstanceType<M>, K>): Builder<InstanceType<M>, WithLoadedRelationsFromConstraintMap<InstanceType<M>, TypedConstraintSelection<InstanceType<M>, K>>>;
  static with<M extends ModelConstructor, R extends TypedConstraintMap<InstanceType<M>> & object>(this: M, constraint: R): Builder<InstanceType<M>, WithLoadedRelationsFromConstraintMap<InstanceType<M>, R>>;
  static with<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>>(this: M, relation: R): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, R>>;
  static with<M extends ModelConstructor>(this: M, relation: LiteralUnion<string & NestedRelationPath<InstanceType<M>>>): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, string>>;
  static with<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>>(this: M, relation: R, callback: TypedConstraintCallback<InstanceType<M>, R>): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, R>>;
  static with<M extends ModelConstructor>(this: M, relation: LiteralUnion<string & NestedRelationPath<InstanceType<M>>>, callback: EagerLoadConstraint): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, string>>;
  static with<M extends ModelConstructor, Rs extends ReadonlyArray<TypedEagerLoad<InstanceType<M>>>>(this: M, relations: Rs): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, ExtractStringPaths<Rs[number]>>>;
  static with<M extends ModelConstructor, Rs extends ReadonlyArray<TypedEagerLoad<InstanceType<M>>>>(this: M, ...relations: Rs): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, ExtractStringPaths<Rs[number]>>>;
  static with<M extends ModelConstructor>(this: M, ...relations: any[]): any {
    return this.query().with(...relations) as any;
  }

  static withTrashed<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return this.query().withTrashed();
  }

  static onlyTrashed<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return this.query().onlyTrashed();
  }

  static withoutGlobalScope<M extends ModelConstructor>(this: M, scope: string): Builder<InstanceType<M>> {
    return this.query().withoutGlobalScope(scope);
  }

  static withoutGlobalScopes<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return this.query().withoutGlobalScopes();
  }

  static scope<M extends ModelConstructor>(this: M, name: string, ...args: any[]): Builder<InstanceType<M>> {
    return this.query().scope(name, ...args);
  }

  static has<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, operator?: string, count?: number): Builder<InstanceType<M>>;
  static has<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, operator?: string, count?: number): Builder<InstanceType<M>>;
  static has<M extends ModelConstructor>(this: M, relationName: string, operator?: string, count?: number): Builder<InstanceType<M>> {
    return this.query().has(relationName as any, operator as any, count as any);
  }

  static whereHas<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, callback?: (query: RelationConstraintQuery<InstanceType<M>, R>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>>;
  static whereHas<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, callback?: (query: Builder<any>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>>;
  static whereHas<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>> {
    return this.query().whereHas(relationName as any, callback as any, operator as any, count as any);
  }

  static doesntHave<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R): Builder<InstanceType<M>>;
  static doesntHave<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>): Builder<InstanceType<M>>;
  static doesntHave<M extends ModelConstructor>(this: M, relationName: string): Builder<InstanceType<M>> {
    return this.query().doesntHave(relationName as any);
  }

  static whereDoesntHave<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, callback?: (query: RelationConstraintQuery<InstanceType<M>, R>) => void | Builder<any>): Builder<InstanceType<M>>;
  static whereDoesntHave<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>>;
  static whereDoesntHave<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return this.query().whereDoesntHave(relationName as any, callback as any);
  }

  static whereRelation<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: ModelColumn<RelationRelatedModel<InstanceType<M>, R>>, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static whereRelation<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static whereRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return this.query().whereRelation(relationName, column, operator, value);
  }

  static orWhereRelation<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: ModelColumn<RelationRelatedModel<InstanceType<M>, R>>, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static orWhereRelation<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static orWhereRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return this.query().orWhereRelation(relationName, column, operator, value);
  }

  static withWhereHas<M extends ModelConstructor, R extends TypedEagerLoad<InstanceType<M>>>(this: M, relation: R, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>>;
  static withWhereHas<M extends ModelConstructor>(this: M, relation: TypedEagerLoad<InstanceType<M>>, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>>;
  static withWhereHas<M extends ModelConstructor>(this: M, relation: any, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return this.query().withWhereHas(relation, callback) as any;
  }

  static withCount<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>, A extends string | undefined = undefined>(this: M, relationName: R, alias?: A): Builder<InstanceType<M>, WithRelationCount<InstanceType<M>, R, A>>;
  static withCount<M extends ModelConstructor, A extends string | undefined = undefined>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, alias?: A): Builder<InstanceType<M>, WithRelationCount<InstanceType<M>, string, A>>;
  static withCount<M extends ModelConstructor>(this: M, relationName: string, alias?: string): Builder<InstanceType<M>, WithRelationCount<InstanceType<M>, string, string | undefined>> {
    return this.query().withCount(relationName, alias);
  }

  static withExists<M extends ModelConstructor, R extends TypedExistsConstraintMap<InstanceType<M>> & object>(
    this: M,
    relations: R
  ): Builder<InstanceType<M>, WithRelationExistsMap<InstanceType<M>, R>>;
  static withExists<M extends ModelConstructor, R extends Record<string, ((query: Builder<any>) => any) | undefined>>(
    this: M,
    relations: R
  ): Builder<InstanceType<M>, WithRelationExistsMap<InstanceType<M>, R>>;
  static withExists<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>>(
    this: M,
    relationName: R,
    callback?: TypedConstraintCallback<InstanceType<M>, R>
  ): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, R>>;
  static withExists<M extends ModelConstructor, R extends string>(
    this: M,
    relationName: R,
    callback?: (query: Builder<any>) => any
  ): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, R>>;
  static withExists<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>, A extends string>(
    this: M,
    relationName: R,
    alias: A,
    callback?: TypedConstraintCallback<InstanceType<M>, R>
  ): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, R, A>>;
  static withExists<M extends ModelConstructor, R extends string, A extends string>(
    this: M,
    relationName: R,
    alias: A,
    callback?: (query: Builder<any>) => any
  ): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, R, A>>;
  static withExists<M extends ModelConstructor>(
    this: M,
    relationOrMap: any,
    aliasOrCallback?: any,
    callback?: any
  ): any {
    return this.query().withExists(relationOrMap, aliasOrCallback, callback);
  }

  static withSum<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return this.query().withSum(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withAvg<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return this.query().withAvg(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withMin<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return this.query().withMin(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withMax<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return this.query().withMax(relationName, column, aliasOrCallback as any, callback as any);
  }

  static async all<M extends ModelConstructor>(this: M): Promise<Collection<InstanceType<M>>> {
    return this.query().get();
  }

  static async count<M extends ModelConstructor>(this: M): Promise<number> {
    return this.query().count();
  }

  static async paginate<M extends ModelConstructor>(this: M, perPage?: number, page?: number): Promise<import("../query/Builder.js").Paginator<InstanceType<M>>> {
    return this.query().paginate(perPage, page);
  }

  static async chunk<M extends ModelConstructor>(this: M, count: number, callback: (items: Collection<InstanceType<M>>) => void | Promise<void>): Promise<void> {
    return this.query().chunk(count, callback);
  }

  static async each<M extends ModelConstructor>(this: M, count: number, callback: (item: InstanceType<M>) => void | Promise<void>): Promise<void> {
    return this.query().each(count, callback);
  }

  static async chunkById<M extends ModelConstructor>(this: M, count: number, callback: (items: import("../support/Collection.js").Collection<InstanceType<M>>) => void | Promise<void>, column?: string): Promise<void> {
    return this.query().chunkById(count, callback as any, column as any);
  }

  static async eachById<M extends ModelConstructor>(this: M, count: number, callback: (item: InstanceType<M>) => void | Promise<void>, column?: string): Promise<void> {
    return this.query().eachById(count, callback as any, column as any);
  }

  static cursor<M extends ModelConstructor>(this: M): AsyncGenerator<InstanceType<M>> {
    return this.query().cursor() as AsyncGenerator<InstanceType<M>>;
  }

  static lazy<M extends ModelConstructor>(this: M, count?: number): AsyncGenerator<InstanceType<M>> {
    return this.query().lazy(count) as AsyncGenerator<InstanceType<M>>;
  }

  static normalizeEagerLoads(relations: (EagerLoadInput | EagerLoadInput[])[]): EagerLoadDefinition[] {
    const normalized: EagerLoadDefinition[] = [];
    for (const relation of relations.flat()) {
      if (typeof relation === "string") {
        normalized.push({ name: relation });
      } else if ("name" in relation && typeof (relation as EagerLoadDefinition).name === "string") {
        normalized.push(relation as EagerLoadDefinition);
      } else {
        for (const [name, constraint] of Object.entries(relation) as [string, EagerLoadConstraint | undefined][]) {
          normalized.push({ name, constraint });
        }
      }
    }
    return normalized;
  }

  static async eagerLoadRelations(models: Model[], relations: (string | EagerLoadDefinition)[]): Promise<void> {
    const normalized = this.normalizeEagerLoads(relations as EagerLoadInput[]);
    const groups = new Map<string, EagerLoadDefinition[]>();

    for (const definition of normalized) {
      const [first] = definition.name.split(".");
      const group = groups.get(first) || [];
      group.push(definition);
      groups.set(first, group);
    }

    for (const [relationName, definitions] of groups) {
      const direct = definitions.find((definition) => definition.name === relationName);
      await this.eagerLoadRelation(models, relationName, direct?.constraint);

      const nestedDefinitions = definitions
        .filter((definition) => definition.name.includes("."))
        .map((definition) => ({
          name: definition.name.split(".").slice(1).join("."),
          constraint: definition.constraint,
        }));

      if (nestedDefinitions.length === 0) continue;

      const nestedModels: Model[] = [];
      for (const model of models) {
        const related = model.getRelation(relationName);
        if (Array.isArray(related)) nestedModels.push(...related);
        else if (related) nestedModels.push(related);
      }
      if (nestedModels.length > 0) {
        await this.eagerLoadRelations(nestedModels, nestedDefinitions);
      }
    }
  }

  static async eagerLoadRelation(models: Model[], relationName: string, constraint?: EagerLoadConstraint): Promise<void> {
    if (models.length === 0) return;
    const firstModel = models[0];
    const relationMethod = findRelationMethod(firstModel, relationName);
    if (!relationMethod) {
      throw new Error(`Relation ${relationName} is not defined on ${firstModel.constructor.name}.`);
    }
    const relation = relationMethod.call(firstModel) as Relation<any>;
    relation.addEagerConstraints(models);
    if (constraint) {
      constraint(relation.getQuery());
    }
    const results = await relation.getEager();
    relation.match(models, results, relationName);
  }

  fill(attributes: Partial<T> | ModelAttributeInput<this>): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (this.isFillable(key)) {
        this.setAttribute(key as any, value as any);
      }
    }
    return this;
  }

  setConnection(connection: Connection): this {
    this.$connection = connection;
    return this;
  }

  getConnection(): Connection {
    return this.$connection || this.getModelConstructor().getConnection();
  }

  protected getModelConstructor(): typeof Model {
    return Object.getPrototypeOf(this).constructor as typeof Model;
  }

  isFillable(key: string): boolean {
    const constructor = this.getModelConstructor();
    const fillable = constructor.fillable || [];
    const guarded = constructor.guarded || [];
    if (fillable.length > 0) {
      return fillable.includes(key);
    }
    if (guarded.length > 0) {
      return !guarded.includes(key);
    }
    return true;
  }

  getAttribute<K extends keyof T>(key: K): T[K];
  getAttribute(key: string): any;
  getAttribute(key: string | keyof T): any {
    const accessors = getAccessors(this);
    if (key in accessors && accessors[key as string].get) {
      return accessors[key as string].get!((this.$attributes as any)[key], this.$attributes as any, this);
    }
    if (Object.prototype.hasOwnProperty.call(this.$castCache, key as string)) {
      return this.$castCache[key as string];
    }
    const value = (this.$attributes as any)[key];
    const casted = this.castAttribute(key as string, value);
    if (this.getCastDefinition(key as string) && value !== null && value !== undefined) {
      this.$castCache[key as string] = casted;
    }
    return casted;
  }

  setAttribute<K extends keyof T>(key: K, value: T[K]): void;
  setAttribute(key: string, value: any): void;
  setAttribute(key: string | keyof T, value: any): void {
    const accessors = getAccessors(this);
    if (key in accessors && accessors[key as string].set) {
      (this.$attributes as any)[key] = accessors[key as string].set!(value, this.$attributes as any, this);
      delete this.$castCache[key as string];
      return;
    }
    (this.$attributes as any)[key] = this.serializeCastAttribute(key as string, value);
    delete this.$castCache[key as string];
  }

  castAttribute(key: string, value: any): any {
    const cast = this.getCastDefinition(key);
    if (!cast || value === null || value === undefined) return value;
    const custom = this.resolveCustomCast(cast);
    if (custom) return custom.get(this, key, value, this.$attributes);
    const [type, argument] = String(cast).split(":");

    switch (type) {
      case "boolean":
      case "bool":
        return !!value;
      case "number":
      case "integer":
      case "int":
      case "float":
      case "double":
        return Number(value);
      case "decimal":
        return Number(value).toFixed(Number(argument || 2));
      case "string":
        return String(value);
      case "date":
      case "datetime":
        return new Date(value);
      case "json":
      case "array":
        return typeof value === "string" ? JSON.parse(value) : value;
      case "object":
        return typeof value === "string" ? JSON.parse(value) : value;
      case "enum":
        return value;
      case "encrypted":
        return typeof value === "string" ? Buffer.from(value, "base64").toString("utf8") : value;
      default:
        return value;
    }
  }

  serializeCastAttribute(key: string, value: any): any {
    const cast = this.getCastDefinition(key);
    if (!cast || value === null || value === undefined) return value;
    const custom = this.resolveCustomCast(cast);
    if (custom) return custom.set(this, key, value, this.$attributes);
    const [type, argument] = String(cast).split(":");

    switch (type) {
      case "boolean":
      case "bool":
        return value ? 1 : 0;
      case "number":
      case "integer":
      case "int":
      case "float":
      case "double":
        return Number(value);
      case "decimal":
        return Number(value).toFixed(Number(argument || 2));
      case "string":
        return String(value);
      case "date":
      case "datetime":
        return value instanceof Date ? value.toISOString() : value;
      case "json":
      case "array":
      case "object":
        return typeof value === "string" ? value : JSON.stringify(value);
      case "enum":
        return typeof value === "object" && "value" in value ? value.value : value;
      case "encrypted":
        return Buffer.from(String(value), "utf8").toString("base64");
      default:
        return value;
    }
  }

  mergeCasts(casts: Record<string, CastDefinition>): this {
    this.$casts = { ...this.$casts, ...casts };
    this.$castCache = {};
    return this;
  }

  protected getCastDefinition(key: string): CastDefinition | undefined {
    const constructor = this.getModelConstructor();
    return this.$casts[key] || (constructor.casts || {})[key];
  }

  protected resolveCustomCast(cast: CastDefinition): CastsAttributes | null {
    if (typeof cast === "string") return null;
    if (typeof cast === "function") return new cast();
    if (typeof cast.get === "function" && typeof cast.set === "function") return cast;
    return null;
  }

  getDirty(): Partial<T> {
    const dirty: Partial<T> = {};
    for (const [key, value] of Object.entries(this.$attributes)) {
      if ((this.$original as any)[key] !== value) {
        (dirty as any)[key] = value;
      }
    }
    return dirty;
  }

  isDirty(): boolean {
    return Object.keys(this.getDirty()).length > 0;
  }

  wasChanged(key?: string): boolean {
    if (key !== undefined) return key in this.$changes;
    return Object.keys(this.$changes).length > 0;
  }

  getChanges(): Partial<T> {
    return { ...this.$changes };
  }

  getOriginal(): Partial<T>;
  getOriginal<K extends keyof T>(key: K): T[K] | undefined;
  getOriginal(key?: string): any {
    if (key !== undefined) return (this.$original as any)[key];
    return { ...this.$original };
  }

  replicate(except?: string[]): this {
    const constructor = this.getModelConstructor();
    const pk = constructor.primaryKey;
    const exclude = new Set([pk, "created_at", "updated_at", ...(except || [])]);
    const attrs: Record<string, any> = {};
    for (const [key, value] of Object.entries(this.$attributes)) {
      if (!exclude.has(key)) attrs[key] = value;
    }
    const instance = new (constructor as any)() as this;
    instance.fill(attrs as any);
    return instance;
  }

  makeHidden(...keys: (string | string[])[]): this {
    const flat = keys.flat();
    this.$hidden = [...new Set([...this.$hidden, ...flat])];
    return this;
  }

  makeVisible(...keys: (string | string[])[]): this {
    const flat = keys.flat();
    this.$visible = [...new Set([...this.$visible, ...flat])];
    this.$hidden = this.$hidden.filter((k) => !flat.includes(k));
    return this;
  }

  is(other: Model | null | undefined): boolean {
    if (!other) return false;
    const ctor = this.getModelConstructor();
    const otherCtor = getModelConstructor(other);
    return ctor.getTable() === otherCtor.getTable() &&
      String(this.getAttribute(ctor.primaryKey)) === String(other.getAttribute(otherCtor.primaryKey));
  }

  isNot(other: Model | null | undefined): boolean {
    return !this.is(other);
  }

  async save(options: SaveOptions = {}): Promise<this> {
    const constructor = this.getModelConstructor();
    const events = options.events !== false;

    if (this.$exists) {
      this.$wasRecentlyCreated = false;
      if (events) await ObserverRegistry.dispatch("saving", this);

      let dirty = this.getDirty();
      if (Object.keys(dirty).length > 0 && constructor.timestamps) {
        (this.$attributes as any)["updated_at"] = this.freshTimestamp();
        delete this.$castCache.updated_at;
        dirty = this.getDirty();
      }
      if (Object.keys(dirty).length > 0) {
        if (events) await ObserverRegistry.dispatch("updating", this);
        const pk = this.getAttribute(constructor.primaryKey);
        const connection = this.getConnection();
        await new Builder(connection, connection.qualifyTable(constructor.getTable()))
          .where(constructor.primaryKey, pk)
          .update(dirty);
        this.$changes = { ...dirty };
        if (events) await ObserverRegistry.dispatch("updated", this);
      } else {
        this.$changes = {};
      }

      this.$original = { ...this.$attributes };

      if (events) await ObserverRegistry.dispatch("saved", this);
    } else {
      if (events) await ObserverRegistry.dispatch("creating", this);
      if (events) await ObserverRegistry.dispatch("saving", this);

      if (constructor.timestamps) {
        const now = this.freshTimestamp();
        (this.$attributes as any)["created_at"] = now;
        (this.$attributes as any)["updated_at"] = now;
        delete this.$castCache.created_at;
        delete this.$castCache.updated_at;
      }

      const primaryKey = constructor.primaryKey;
      const primaryKeyValue = this.getAttribute(primaryKey);
      const shouldGeneratePrimaryKey = await constructor.shouldAutoGeneratePrimaryKey();
      if ((primaryKeyValue === null || primaryKeyValue === undefined || primaryKeyValue === "") && shouldGeneratePrimaryKey) {
        const generated = crypto.randomUUID();
        (this.$attributes as any)[primaryKey] = generated;
        delete this.$castCache[primaryKey];
      }

      const connection = this.getConnection();
      if (shouldGeneratePrimaryKey || primaryKeyValue !== null && primaryKeyValue !== undefined && primaryKeyValue !== "") {
        await new Builder(connection, connection.qualifyTable(constructor.getTable())).insert(this.$attributes);
      } else {
        const result = await new Builder(connection, connection.qualifyTable(constructor.getTable())).insertGetId(this.$attributes);
        if (result) {
          (this.$attributes as any)[constructor.primaryKey] = result;
          delete this.$castCache[constructor.primaryKey];
        }
      }

      this.$exists = true;
      this.$wasRecentlyCreated = true;
      this.$original = { ...this.$attributes };
      this.$changes = {};

      if (events) await ObserverRegistry.dispatch("created", this);
      if (events) await ObserverRegistry.dispatch("saved", this);
    }

    const identityMap = IdentityMap.current();
    if (identityMap) {
      const pk = this.getAttribute(constructor.primaryKey);
      if (pk !== null && pk !== undefined && pk !== "") {
        IdentityMap.set(constructor.getTable(), pk, this);
      }
    }

    await this.touchOwners();

    return this;
  }

  async update(attributes: Partial<T> | ModelAttributeInput<this>, options: SaveOptions = {}): Promise<this> {
    this.fill(attributes);
    return this.save(options);
  }

  private async touchOwners(): Promise<void> {
    const constructor = this.getModelConstructor();
    const touches = constructor.touches || [];
    for (const relationName of touches) {
      const method = findRelationMethod(this, relationName);
      if (!method) continue;
      const relation = method.call(this);
      if (relation && typeof relation.getResults === "function") {
        const related = await relation.getResults();
        if (related && typeof (related as any).touch === "function") {
          await (related as any).touch();
        }
      }
    }
  }

  saveQuietly(): Promise<this> {
    return this.save({ events: false });
  }

  updateTimestamps(): void {
    const constructor = this.getModelConstructor();
    if (!constructor.timestamps) return;
    const now = this.freshTimestamp();
    (this.$attributes as any)["updated_at"] = now;
    delete this.$castCache.updated_at;
    if (!this.$exists) {
      (this.$attributes as any)["created_at"] = now;
      delete this.$castCache.created_at;
    }
  }

  async touch(): Promise<boolean> {
    if (!this.$exists) return false;
    const constructor = this.getModelConstructor();
    if (!constructor.timestamps) return false;
    const now = this.freshTimestamp();
    const pk = this.getAttribute(constructor.primaryKey);
    const connection = this.getConnection();
    await new Builder(connection, connection.qualifyTable(constructor.getTable()))
      .where(constructor.primaryKey, pk)
      .update({ updated_at: now } as any);
    (this.$attributes as any)["updated_at"] = now;
    delete this.$castCache.updated_at;
    this.$original = { ...this.$attributes };
    return true;
  }

  async increment<K extends ModelColumn<this>>(column: K, amount: number = 1, extra: ModelAttributeInput<this> = {}): Promise<this> {
    const constructor = this.getModelConstructor();
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return this;

    const connection = this.getConnection();
    const builder = new Builder(connection, connection.qualifyTable(constructor.getTable()))
      .where(constructor.primaryKey, pk);

    if (constructor.timestamps) {
      extra = { ...extra, updated_at: this.freshTimestamp() };
    }

    await builder.increment(column, amount, extra);
    (this.$attributes as any)[column] = ((this.$attributes as any)[column] || 0) + amount;
    delete this.$castCache[column as string];
    for (const [key, value] of Object.entries(extra)) {
      (this.$attributes as any)[key] = value;
      delete this.$castCache[key];
    }
    this.$original = { ...this.$attributes };
    return this;
  }

  async decrement<K extends ModelColumn<this>>(column: K, amount: number = 1, extra: ModelAttributeInput<this> = {}): Promise<this> {
    return this.increment(column, -amount, extra);
  }

  async load(...relations: (EagerLoadInput | EagerLoadInput[])[]): Promise<this> {
    const constructor = this.getModelConstructor();
    await constructor.eagerLoadRelations([this], relations as any);
    return this;
  }

  async delete(): Promise<boolean> {
    const constructor = this.getModelConstructor();
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;
    await ObserverRegistry.dispatch("deleting", this);

    if (constructor.softDeletes) {
      const deletedAt = this.freshTimestamp();
      const connection = this.getConnection();
      await new Builder(connection, connection.qualifyTable(constructor.getTable()))
        .where(constructor.primaryKey, pk)
        .update({ [constructor.deletedAtColumn]: deletedAt } as any);
      (this.$attributes as any)[constructor.deletedAtColumn] = deletedAt;
      delete this.$castCache[constructor.deletedAtColumn];
      this.$original = { ...this.$attributes };
    } else {
      const connection = this.getConnection();
      await new Builder(connection, connection.qualifyTable(constructor.getTable()))
        .where(constructor.primaryKey, pk)
        .delete();
      this.$exists = false;
    }

    const identityMap = IdentityMap.current();
    if (identityMap) {
      IdentityMap.delete(constructor.getTable(), pk);
    }

    await ObserverRegistry.dispatch("deleted", this);
    return true;
  }

  async deleteQuietly(): Promise<boolean> {
    const constructor = this.getModelConstructor();
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;

    if (constructor.softDeletes) {
      const deletedAt = this.freshTimestamp();
      const connection = this.getConnection();
      await new Builder(connection, connection.qualifyTable(constructor.getTable()))
        .where(constructor.primaryKey, pk)
        .update({ [constructor.deletedAtColumn]: deletedAt } as any);
      (this.$attributes as any)[constructor.deletedAtColumn] = deletedAt;
      delete this.$castCache[constructor.deletedAtColumn];
      this.$original = { ...this.$attributes };
    } else {
      const connection = this.getConnection();
      await new Builder(connection, connection.qualifyTable(constructor.getTable()))
        .where(constructor.primaryKey, pk)
        .delete();
      this.$exists = false;
    }

    const identityMap = IdentityMap.current();
    if (identityMap) IdentityMap.delete(constructor.getTable(), pk);

    return true;
  }

  async restore(): Promise<boolean> {
    const constructor = this.getModelConstructor();
    if (!constructor.softDeletes) return false;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;

    const connection = this.getConnection();
    await new Builder(connection, connection.qualifyTable(constructor.getTable()))
      .where(constructor.primaryKey, pk)
      .update({ [constructor.deletedAtColumn]: null } as any);
    (this.$attributes as any)[constructor.deletedAtColumn] = null;
    delete this.$castCache[constructor.deletedAtColumn];
    this.$original = { ...this.$attributes };
    this.$exists = true;
    return true;
  }

  async forceDelete(): Promise<boolean> {
    const constructor = this.getModelConstructor();
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;
    const connection = this.getConnection();
    await new Builder(connection, connection.qualifyTable(constructor.getTable()))
      .where(constructor.primaryKey, pk)
      .delete();
    this.$exists = false;

    const identityMap = IdentityMap.current();
    if (identityMap) {
      IdentityMap.delete(constructor.getTable(), pk);
    }

    return true;
  }

  async refresh(): Promise<this> {
    const constructor = this.getModelConstructor();
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return this;

    // Bypass identity map to fetch fresh data
    const identityMap = IdentityMap.current();
    if (identityMap) {
      IdentityMap.delete(constructor.getTable(), pk);
    }

    const result = await constructor.find(pk);
    if (result) {
      this.$attributes = result.$attributes as T;
      this.$original = { ...result.$attributes } as Partial<T>;
      this.$castCache = {};
      // Ensure this instance is the canonical one in the identity map
      if (identityMap) {
        IdentityMap.set(constructor.getTable(), pk, this);
      }
    }
    return this;
  }

  private isVisible(key: string): boolean {
    const constructor = this.getModelConstructor();
    const visible = [...constructor.visible, ...this.$visible];
    if (visible.length > 0) return visible.includes(key);
    const hidden = new Set([...constructor.hidden, ...this.$hidden]);
    return !hidden.has(key);
  }

  private serialize(includeRelations: boolean = true): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of Object.keys(this.$attributes)) {
      if (this.isVisible(key)) result[key] = this.getAttribute(key);
    }
    if (includeRelations) {
      for (const key of Object.keys(this.$relations)) {
        if (!this.isVisible(key)) continue;
        const value = this.$relations[key];
        if (value === null || value === undefined) {
          result[key] = value;
        } else if (typeof value.toJSON === "function") {
          result[key] = value.toJSON();
        } else if (Array.isArray(value)) {
          result[key] = value.map((item: any) => typeof item?.toJSON === "function" ? item.toJSON() : item);
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  }

  toJSON(): ModelJson<this> {
    return this.serialize(true) as ModelJson<this>;
  }

  json(options?: { relations?: boolean }): ModelJson<this> {
    return this.serialize(options?.relations !== false) as ModelJson<this>;
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }

  freshTimestamp(): string {
    return new Date().toISOString();
  }

  setRelation(name: string, value: any): void {
    this.$relations[name] = value;
  }

  getRelation(name: string): any {
    return this.$relations[name];
  }

  // Relations
  hasMany<R extends Model>(related: ModelConstructor<R>, foreignKey?: string, localKey?: string): HasMany<R> {
    return new HasMany<R>(this, related as any, foreignKey, localKey);
  }

  belongsTo<R extends Model>(related: ModelConstructor<R>, foreignKey?: string, ownerKey?: string): BelongsTo<R> {
    return new BelongsTo<R>(this, related as any, foreignKey, ownerKey);
  }

  hasOne<R extends Model>(related: ModelConstructor<R>, foreignKey?: string, localKey?: string): HasOne<R> {
    return new HasOne<R>(this, related as any, foreignKey, localKey);
  }

  hasManyThrough<R extends Model>(
    related: ModelConstructor<R>,
    through: ModelConstructor,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string
  ): HasManyThrough<R> {
    return new HasManyThrough<R>(this, related as any, through as any, firstKey, secondKey, localKey, secondLocalKey);
  }

  hasOneThrough<R extends Model>(
    related: ModelConstructor<R>,
    through: ModelConstructor,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string
  ): HasOneThrough<R> {
    return new HasOneThrough<R>(this, related as any, through as any, firstKey, secondKey, localKey, secondLocalKey);
  }

  belongsToMany<R extends Model>(
    related: ModelConstructor<R>,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): BelongsToMany<R>;
  belongsToMany<R extends Model, P extends Model>(
    related: ModelConstructor<R>,
    pivot: ModelConstructor<P>,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): BelongsToMany<R>;
  belongsToMany<R extends Model>(
    related: ModelConstructor<R>,
    tableOrPivot?: string | ModelConstructor,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): BelongsToMany<R> {
    return new BelongsToMany<R>(this, related as any, tableOrPivot as any, foreignPivotKey, relatedPivotKey, parentKey, relatedKey);
  }

  // Polymorphic relations
  morphTo(name: string, typeMap?: Record<string, ModelConstructor>): MorphTo {
    return new MorphTo(this, name, typeMap);
  }

  morphOne<R extends Model>(
    related: ModelConstructor<R>,
    name: string,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ): MorphOne<R> {
    return new MorphOne<R>(this, related as any, name, typeColumn, idColumn, localKey);
  }

  morphMany<R extends Model>(
    related: ModelConstructor<R>,
    name: string,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ): MorphMany<R> {
    return new MorphMany<R>(this, related as any, name, typeColumn, idColumn, localKey);
  }

  morphToMany<R extends Model>(
    related: ModelConstructor<R>,
    name: string,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): MorphToMany<R> {
    const constructor = this.getModelConstructor();
    const type = constructor.morphName || constructor.name;
    return new MorphToMany<R>(
      this,
      related as any,
      name,
      table,
      foreignPivotKey || `${snakeCase(name)}_id`,
      relatedPivotKey || `${snakeCase(related.name)}_id`,
      parentKey,
      relatedKey,
      type
    );
  }

  morphedByMany<R extends Model>(
    related: ModelConstructor<R>,
    name: string,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): MorphToMany<R> {
    const type = related.morphName || related.name;
    const constructor = this.getModelConstructor();
    return new MorphToMany<R>(
      this,
      related as any,
      name,
      table,
      foreignPivotKey || `${snakeCase(constructor.name)}_id`,
      relatedPivotKey || `${snakeCase(name)}_id`,
      parentKey,
      relatedKey,
      type
    );
  }
}
