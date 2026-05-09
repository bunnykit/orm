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

export type ModelConstructor<T extends Model = Model> = (new (...args: any[]) => T) & Omit<typeof Model, "prototype">;
export type GlobalScope = (builder: Builder<any>, model: ModelConstructor) => void;
export type LiteralUnion<T extends string> = T | (string & {});
type BaseModelInstanceKey =
  | "$attributes"
  | "$original"
  | "$exists"
  | "$relations"
  | "$casts"
  | "$connection"
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
  | "save"
  | "updateTimestamps"
  | "touch"
  | "increment"
  | "decrement"
  | "load"
  | "delete"
  | "restore"
  | "forceDelete"
  | "refresh"
  | "toJSON"
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
export type ModelRelationValue =
  | Relation<any>
  | MorphTo<any>
  | MorphOne<any>
  | MorphMany<any>
  | MorphToMany<any>
  | BelongsToMany<any>;
export type ModelRelationName<T> = LiteralUnion<Extract<{
  [K in keyof T]-?: T[K] extends (...args: any[]) => ModelRelationValue ? K : never;
}[keyof T], string>>;
export type CastDefinition =
  | string
  | CastsAttributes
  | (new (...args: any[]) => CastsAttributes);

export interface CastsAttributes {
  get(model: Model, key: string, value: any, attributes: Record<string, any>): any;
  set(model: Model, key: string, value: any, attributes: Record<string, any>): any;
}

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
      if ((this.parent.constructor as typeof Model).preventLazyLoading) {
        throw new Error(
          `Lazy loading is prevented on ${(this.parent.constructor as typeof Model).name}. ` +
            `Eager load the relation using with().`
        );
      }
      return await originalGetResults();
    };
  }

  abstract addConstraints(): void;
  abstract getResults(): Promise<T | T[] | null>;
  abstract addEagerConstraints(models: Model[]): void;
  abstract getEager(): Promise<any[]>;
  abstract match(models: Model[], results: any[], relationName: string): void;

  protected defaultForeignKey(): string {
    return `${snakeCase(this.parent.constructor.name)}_id`;
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
    this.localKey = localKey || (parent.constructor as typeof Model).primaryKey;
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.addConstraints();
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

  async getEager(): Promise<any[]> {
    return this.builder.get();
  }

  match(models: Model[], results: any[], relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignKey];
      if (!dictionary[key]) dictionary[key] = [];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, dictionary[String(key)] || []);
    }
  }

  async getResults(): Promise<T[]> {
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
  constructor(parent: Model, related: ModelConstructor, foreignKey?: string, ownerKey?: string) {
    super(parent, related, foreignKey, ownerKey);
    this.foreignKey = foreignKey || `${snakeCase(related.name)}_id`;
    this.localKey = ownerKey || related.primaryKey;
    this.addConstraints();
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

  async getEager(): Promise<any[]> {
    return this.builder.get();
  }

  match(models: Model[], results: any[], relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.localKey];
      dictionary[String(key)] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.foreignKey);
      model.setRelation(relationName, dictionary[String(key)] || null);
    }
  }

  async getResults(): Promise<T | null> {
    return this.builder.first();
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
    this.through = through;
    this.localKey = localKey || (parent.constructor as typeof Model).primaryKey;
    this.firstKey = firstKey || `${snakeCase(parent.constructor.name)}_id`;
    this.secondKey = secondKey || `${snakeCase(through.name)}_id`;
    this.secondLocalKey = secondLocalKey || through.primaryKey;
    this.addConstraints();
  }

  addConstraints(): void {
    const throughTable = this.through.getTable();
    const relatedTable = this.related.getTable();
    this.builder.select(`${relatedTable}.*`);
    this.builder.join(
      throughTable,
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
      throughTable,
      `${throughTable}.${this.secondLocalKey}`,
      "=",
      `${relatedTable}.${this.secondKey}`
    );
    this.builder.whereIn(`${throughTable}.${this.firstKey}`, keys);
  }

  async getEager(): Promise<any[]> {
    return this.builder.get();
  }

  match(models: Model[], results: any[], relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.firstKey];
      if (!dictionary[key]) dictionary[key] = [];
      delete (result.$attributes as any)[this.firstKey];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, dictionary[String(key)] || []);
    }
  }

  async getResults(): Promise<T[] | T | null> {
    return this.builder.get();
  }

  protected newExistenceQuery(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const throughTable = this.through.getTable();
    const relatedTable = this.related.getTable();
    const query = (this.related as any).on(parentQuery.connection).select(aggregate);
    query.join(
      throughTable,
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

  match(models: Model[], results: any[], relationName: string): void {
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
  constructor(parent: Model, related: ModelConstructor, foreignKey?: string, localKey?: string) {
    super(parent, related, foreignKey, localKey);
    this.localKey = localKey || (parent.constructor as typeof Model).primaryKey;
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.addConstraints();
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

  async getEager(): Promise<any[]> {
    return this.builder.get();
  }

  match(models: Model[], results: any[], relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignKey];
      dictionary[String(key)] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, dictionary[String(key)] || null);
    }
  }

  async getResults(): Promise<T | null> {
    return this.builder.first();
  }
}

export class Model<T extends Record<string, any> = Record<string, any>> {
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

  $attributes = {} as T;
  $original = {} as Partial<T>;
  $exists = false;
  $relations: Record<string, any> = {};
  $casts: Record<string, CastDefinition> = {};
  $connection?: Connection;

  constructor(attributes?: Partial<T>) {
    const defaults = (this.constructor as typeof Model).attributes;
    if (Object.keys(defaults).length > 0) {
      this.fill({ ...defaults } as Partial<T>);
    }
    if (attributes) {
      this.fill(attributes);
    }
    this.syncAttributeProperties();

    // Minimal Proxy fallback for dynamic property access on undefined keys.
    // Pre-defined attribute getters/setters bypass the Proxy entirely.
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && !(prop in target) && prop in target.$attributes) {
          return target.getAttribute(prop);
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (typeof prop === "string" && !prop.startsWith("$") && !(prop in target)) {
          target.setAttribute(prop, value);
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      },
    });
  }

  private defineAttributeProperty(key: string): void {
    if (key in this) return;
    Object.defineProperty(this, key, {
      get: () => this.getAttribute(key),
      set: (value) => this.setAttribute(key, value),
      enumerable: true,
      configurable: true,
    });
  }

  private syncAttributeProperties(): void {
    for (const key of Object.keys(this.$attributes)) {
      this.defineAttributeProperty(key);
    }
  }

  static getTable(): string {
    return this.table || snakeCase(this.name) + "s";
  }

  static getConnection(): Connection {
    const tenantConnection = TenantContext.current()?.connection;
    const ownConnection = Object.prototype.hasOwnProperty.call(this, "connection") ? this.connection : undefined;
    const connection = ownConnection || tenantConnection || this.connection || ConnectionManager.getDefault();
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

  static async create<M extends ModelConstructor>(this: M, attributes: ModelAttributeInput<InstanceType<M>>): Promise<InstanceType<M>> {
    const instance = new this() as InstanceType<M>;
    instance.fill(attributes as any);
    await instance.save();
    return instance;
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

  static with<M extends ModelConstructor>(this: M, ...relations: ModelRelationName<InstanceType<M>>[]): Builder<InstanceType<M>> {
    return this.query().with(...relations);
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

  static has<M extends ModelConstructor>(this: M, relationName: string, operator?: string, count?: number): Builder<InstanceType<M>> {
    return this.query().has(relationName, operator, count);
  }

  static whereHas<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>> {
    return this.query().whereHas(relationName, callback, operator, count);
  }

  static doesntHave<M extends ModelConstructor>(this: M, relationName: string): Builder<InstanceType<M>> {
    return this.query().doesntHave(relationName);
  }

  static withCount<M extends ModelConstructor>(this: M, relationName: string, alias?: string): Builder<InstanceType<M>> {
    return this.query().withCount(relationName, alias);
  }

  static withSum<M extends ModelConstructor>(this: M, relationName: string, column: ModelColumn<InstanceType<M>>, alias?: string): Builder<InstanceType<M>> {
    return this.query().withSum(relationName, column, alias);
  }

  static withAvg<M extends ModelConstructor>(this: M, relationName: string, column: ModelColumn<InstanceType<M>>, alias?: string): Builder<InstanceType<M>> {
    return this.query().withAvg(relationName, column, alias);
  }

  static withMin<M extends ModelConstructor>(this: M, relationName: string, column: ModelColumn<InstanceType<M>>, alias?: string): Builder<InstanceType<M>> {
    return this.query().withMin(relationName, column, alias);
  }

  static withMax<M extends ModelConstructor>(this: M, relationName: string, column: ModelColumn<InstanceType<M>>, alias?: string): Builder<InstanceType<M>> {
    return this.query().withMax(relationName, column, alias);
  }

  static async all<M extends ModelConstructor>(this: M): Promise<InstanceType<M>[]> {
    return this.query().get();
  }

  static async paginate<M extends ModelConstructor>(this: M, perPage?: number, page?: number): Promise<import("../query/Builder.js").Paginator<InstanceType<M>>> {
    return this.query().paginate(perPage, page);
  }

  static async chunk<M extends ModelConstructor>(this: M, count: number, callback: (items: InstanceType<M>[]) => void | Promise<void>): Promise<void> {
    return this.query().chunk(count, callback);
  }

  static async each<M extends ModelConstructor>(this: M, count: number, callback: (item: InstanceType<M>) => void | Promise<void>): Promise<void> {
    return this.query().each(count, callback);
  }

  static cursor<M extends ModelConstructor>(this: M): AsyncGenerator<InstanceType<M>> {
    return this.query().cursor() as AsyncGenerator<InstanceType<M>>;
  }

  static lazy<M extends ModelConstructor>(this: M, count?: number): AsyncGenerator<InstanceType<M>> {
    return this.query().lazy(count) as AsyncGenerator<InstanceType<M>>;
  }

  static async eagerLoadRelations(models: Model[], relations: string[]): Promise<void> {
    for (const relationName of relations) {
      if (relationName.includes(".")) {
        const [first, ...rest] = relationName.split(".");
        await this.eagerLoadRelation(models, first);
        const nestedModels: Model[] = [];
        for (const model of models) {
          const related = model.getRelation(first);
          if (Array.isArray(related)) nestedModels.push(...related);
          else if (related) nestedModels.push(related);
        }
        if (nestedModels.length > 0) {
          await this.eagerLoadRelations(nestedModels, [rest.join(".")]);
        }
      } else {
        await this.eagerLoadRelation(models, relationName);
      }
    }
  }

  static async eagerLoadRelation(models: Model[], relationName: string): Promise<void> {
    if (models.length === 0) return;
    const firstModel = models[0];
    const relation = (firstModel as any)[relationName]() as Relation<any>;
    relation.addEagerConstraints(models);
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
    return this.$connection || (this.constructor as typeof Model).getConnection();
  }

  isFillable(key: string): boolean {
    const constructor = this.constructor as typeof Model;
    if (constructor.fillable.length > 0) {
      return constructor.fillable.includes(key);
    }
    if (constructor.guarded.length > 0) {
      return !constructor.guarded.includes(key);
    }
    return true;
  }

  getAttribute<K extends keyof T>(key: K): T[K];
  getAttribute(key: string): any;
  getAttribute(key: string | keyof T): any {
    const value = (this.$attributes as any)[key];
    return this.castAttribute(key as string, value);
  }

  setAttribute<K extends keyof T>(key: K, value: T[K]): void;
  setAttribute(key: string, value: any): void;
  setAttribute(key: string | keyof T, value: any): void {
    (this.$attributes as any)[key] = this.serializeCastAttribute(key as string, value);
    this.defineAttributeProperty(key as string);
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
    return this;
  }

  protected getCastDefinition(key: string): CastDefinition | undefined {
    const constructor = this.constructor as typeof Model;
    return this.$casts[key] || constructor.casts[key];
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

  async save(): Promise<this> {
    const constructor = this.constructor as typeof Model;

    if (this.$exists) {
      await ObserverRegistry.dispatch("updating", this);
      await ObserverRegistry.dispatch("saving", this);

      if (constructor.timestamps) {
        (this.$attributes as any)["updated_at"] = this.freshTimestamp();
      }

      const dirty = this.getDirty();
      if (Object.keys(dirty).length > 0) {
        const pk = this.getAttribute(constructor.primaryKey);
        const connection = this.getConnection();
        await new Builder(connection, connection.qualifyTable(constructor.getTable()))
          .where(constructor.primaryKey, pk)
          .update(dirty);
      }

      this.$original = { ...this.$attributes };

      await ObserverRegistry.dispatch("updated", this);
      await ObserverRegistry.dispatch("saved", this);
    } else {
      await ObserverRegistry.dispatch("creating", this);
      await ObserverRegistry.dispatch("saving", this);

      if (constructor.timestamps) {
        const now = this.freshTimestamp();
        (this.$attributes as any)["created_at"] = now;
        (this.$attributes as any)["updated_at"] = now;
      }

      const primaryKey = constructor.primaryKey;
      const primaryKeyValue = this.getAttribute(primaryKey);
      const shouldGeneratePrimaryKey = await constructor.shouldAutoGeneratePrimaryKey();
      if ((primaryKeyValue === null || primaryKeyValue === undefined || primaryKeyValue === "") && shouldGeneratePrimaryKey) {
        const generated = crypto.randomUUID();
        (this.$attributes as any)[primaryKey] = generated;
      }

      const connection = this.getConnection();
      if (shouldGeneratePrimaryKey || primaryKeyValue !== null && primaryKeyValue !== undefined && primaryKeyValue !== "") {
        await new Builder(connection, connection.qualifyTable(constructor.getTable())).insert(this.$attributes);
      } else {
        const result = await new Builder(connection, connection.qualifyTable(constructor.getTable())).insertGetId(this.$attributes);
        if (result) {
          (this.$attributes as any)[constructor.primaryKey] = result;
        }
      }

      this.$exists = true;
      this.$original = { ...this.$attributes };

      await ObserverRegistry.dispatch("created", this);
      await ObserverRegistry.dispatch("saved", this);
    }

    this.syncAttributeProperties();

    const identityMap = IdentityMap.current();
    if (identityMap) {
      const pk = this.getAttribute(constructor.primaryKey);
      if (pk !== null && pk !== undefined && pk !== "") {
        IdentityMap.set(constructor.getTable(), pk, this);
      }
    }

    return this;
  }

  updateTimestamps(): void {
    const constructor = this.constructor as typeof Model;
    if (!constructor.timestamps) return;
    const now = this.freshTimestamp();
    (this.$attributes as any)["updated_at"] = now;
    if (!this.$exists) {
      (this.$attributes as any)["created_at"] = now;
    }
    this.syncAttributeProperties();
  }

  async touch(): Promise<boolean> {
    if (!this.$exists) return false;
    const constructor = this.constructor as typeof Model;
    if (!constructor.timestamps) return false;
    const now = this.freshTimestamp();
    const pk = this.getAttribute(constructor.primaryKey);
    const connection = this.getConnection();
    await new Builder(connection, connection.qualifyTable(constructor.getTable()))
      .where(constructor.primaryKey, pk)
      .update({ updated_at: now } as any);
    (this.$attributes as any)["updated_at"] = now;
    this.$original = { ...this.$attributes };
    this.syncAttributeProperties();
    return true;
  }

  async increment<K extends ModelColumn<this>>(column: K, amount: number = 1, extra: ModelAttributeInput<this> = {}): Promise<this> {
    const constructor = this.constructor as typeof Model;
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
    for (const [key, value] of Object.entries(extra)) {
      (this.$attributes as any)[key] = value;
    }
    this.$original = { ...this.$attributes };
    this.syncAttributeProperties();
    return this;
  }

  async decrement<K extends ModelColumn<this>>(column: K, amount: number = 1, extra: ModelAttributeInput<this> = {}): Promise<this> {
    return this.increment(column, -amount, extra);
  }

  async load(...relations: string[]): Promise<this> {
    const constructor = this.constructor as typeof Model;
    await constructor.eagerLoadRelations([this], relations);
    return this;
  }

  async delete(): Promise<boolean> {
    const constructor = this.constructor as typeof Model;
    await ObserverRegistry.dispatch("deleting", this);

    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;

    if (constructor.softDeletes) {
      const deletedAt = this.freshTimestamp();
      const connection = this.getConnection();
      await new Builder(connection, connection.qualifyTable(constructor.getTable()))
        .where(constructor.primaryKey, pk)
        .update({ [constructor.deletedAtColumn]: deletedAt } as any);
      (this.$attributes as any)[constructor.deletedAtColumn] = deletedAt;
      this.$original = { ...this.$attributes };
      this.syncAttributeProperties();
    } else {
      const connection = this.getConnection();
      await new Builder(connection, connection.qualifyTable(constructor.getTable()))
        .where(constructor.primaryKey, pk)
        .delete();
      this.$exists = false;
    }

    await ObserverRegistry.dispatch("deleted", this);
    return true;
  }

  async restore(): Promise<boolean> {
    const constructor = this.constructor as typeof Model;
    if (!constructor.softDeletes) return false;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;

    const connection = this.getConnection();
    await new Builder(connection, connection.qualifyTable(constructor.getTable()))
      .where(constructor.primaryKey, pk)
      .update({ [constructor.deletedAtColumn]: null } as any);
    (this.$attributes as any)[constructor.deletedAtColumn] = null;
    this.$original = { ...this.$attributes };
    this.$exists = true;
    this.syncAttributeProperties();
    return true;
  }

  async forceDelete(): Promise<boolean> {
    const constructor = this.constructor as typeof Model;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;
    const connection = this.getConnection();
    await new Builder(connection, connection.qualifyTable(constructor.getTable()))
      .where(constructor.primaryKey, pk)
      .delete();
    this.$exists = false;
    return true;
  }

  async refresh(): Promise<this> {
    const constructor = this.constructor as typeof Model;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return this;

    const result = await constructor.find(pk);
    if (result) {
      this.$attributes = result.$attributes as T;
      this.$original = { ...result.$attributes } as Partial<T>;
      this.syncAttributeProperties();
    }
    return this;
  }

  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of Object.keys(this.$attributes)) {
      result[key] = this.getAttribute(key);
    }
    return result;
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
  ): BelongsToMany<R> {
    return new BelongsToMany<R>(this, related as any, table, foreignPivotKey, relatedPivotKey, parentKey, relatedKey);
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
    const type = (this.constructor as typeof Model).morphName || this.constructor.name;
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
    return new MorphToMany<R>(
      this,
      related as any,
      name,
      table,
      foreignPivotKey || `${snakeCase(this.constructor.name)}_id`,
      relatedPivotKey || `${snakeCase(name)}_id`,
      parentKey,
      relatedKey,
      type
    );
  }
}
