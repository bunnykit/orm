import { Builder } from "../query/Builder.js";
import { Collection } from "../support/Collection.js";
import { snakeCase } from "../utils.js";
import { MorphMap } from "./MorphMap.js";
import type { Model, ModelConstructor, PivotQueryBuilder } from "./Model.js";

function getModelConstructor(model: Model): typeof Model {
  return Object.getPrototypeOf(model).constructor as typeof Model;
}

export class MorphTo<T extends Model = Model> {
  protected parent: Model;
  protected name: string;
  protected typeColumn: string;
  protected idColumn: string;
  protected typeMap?: Record<string, ModelConstructor>;
  protected eagerModels: Model[] = [];

  constructor(parent: Model, name: string, typeMap?: Record<string, ModelConstructor>) {
    this.parent = parent;
    this.name = name;
    this.typeColumn = `${name}_type`;
    this.idColumn = `${name}_id`;
    this.typeMap = typeMap;

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

  async getResults(): Promise<T | null> {
    const type = this.parent.getAttribute(this.typeColumn) as string;
    const id = this.parent.getAttribute(this.idColumn);
    if (!type || !id) return null;
    return this.resolveAndFind(type, id);
  }

  get(): Promise<T | null> { return this.getResults(); }

  private resolveRelated(type: string): ModelConstructor | undefined {
    let Related: ModelConstructor | undefined;
    if (this.typeMap) {
      Related = this.typeMap[type];
    }
    if (!Related) {
      Related = MorphMap.get(type);
    }
    return Related;
  }

  private async resolveAndFind(type: string, id: any): Promise<T | null> {
    const Related = this.resolveRelated(type);
    if (!Related) this.throwMissingMorph(type);
    return (Related as any).on(this.parent.getConnection()).find(id) as Promise<T | null>;
  }

  private throwMissingMorph(type: string): never {
    throw new Error(
      `No morph mapping found for type: ${type}. Register it with MorphMap.register() or pass a typeMap.`
    );
  }

  addEagerConstraints(models: Model[]): void {
    this.eagerModels = models;
  }

  async getEager(): Promise<Collection<any>> {
    const results: Array<{ __morphType: string; model: Model }> = [];
    const groups: Record<string, Model[]> = {};

    for (const model of this.eagerModels) {
      const type = model.getAttribute(this.typeColumn) as string;
      if (!type) continue;
      if (!groups[type]) groups[type] = [];
      groups[type].push(model);
    }

    for (const [type, models] of Object.entries(groups)) {
      const Related = this.resolveRelated(type);
      if (!Related) this.throwMissingMorph(type);

      const ids = [...new Set(models.map((model) => model.getAttribute(this.idColumn)).filter((id) => id !== null && id !== undefined))];
      if (ids.length === 0) continue;

      const relatedModels = await (Related as any).on(models[0].getConnection()).whereIn(Related.primaryKey, ids).get();
      for (const model of relatedModels as Model[]) {
        results.push({ __morphType: type, model });
      }
    }

    return new Collection(results);
  }

  match(models: Model[], results: Collection<{ __morphType: string; model: Model }>, relationName: string): void {
    const dictionary: Record<string, Model> = {};
    for (const result of results) {
      const key = result.model.getAttribute(getModelConstructor(result.model).primaryKey);
      dictionary[`${result.__morphType}:${String(key)}`] = result.model;
    }

    for (const model of models) {
      const type = model.getAttribute(this.typeColumn) as string;
      const id = model.getAttribute(this.idColumn);
      model.setRelation(relationName, dictionary[`${type}:${String(id)}`] || null);
    }
  }
}

export class MorphOne<T extends Model = Model> {
  protected builder: Builder<T>;
  protected parent: Model;
  protected related: ModelConstructor;
  protected name: string;
  protected typeColumn: string;
  protected idColumn: string;
  protected localKey: string;

  constructor(
    parent: Model,
    related: ModelConstructor,
    name: string,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ) {
    this.parent = parent;
    this.related = related;
    this.name = name;
    this.typeColumn = typeColumn || `${name}_type`;
    this.idColumn = idColumn || `${name}_id`;
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.builder = (related as any).on(parent.getConnection());
    this.builder.where(this.typeColumn, this.getMorphType());
    this.builder.where(this.idColumn, this.parent.getAttribute(this.localKey));

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

  protected getMorphType(): string {
    const parentConstructor = getModelConstructor(this.parent);
    return parentConstructor.morphName || parentConstructor.name;
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  addEagerConstraints(models: Model[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey));
    this.builder.whereIn(this.idColumn, keys);
    this.builder.where(this.typeColumn, this.getMorphType());
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.idColumn];
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

  get(): Promise<T | null> { return this.getResults(); }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getTable()}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(this.parent.getConnection()).select(aggregate);
    query.whereColumn(`${this.related.getTable()}.${this.idColumn}`, "=", `${parentTable}.${this.localKey}`);
    query.where(`${this.related.getTable()}.${this.typeColumn}`, this.getMorphType());
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, "1", callback).toSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, aggregate, callback).toSql();
  }
}

export class MorphMany<T extends Model = Model> {
  protected builder: Builder<T>;
  protected parent: Model;
  protected related: ModelConstructor;
  protected name: string;
  protected typeColumn: string;
  protected idColumn: string;
  protected localKey: string;

  constructor(
    parent: Model,
    related: ModelConstructor,
    name: string,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ) {
    this.parent = parent;
    this.related = related;
    this.name = name;
    this.typeColumn = typeColumn || `${name}_type`;
    this.idColumn = idColumn || `${name}_id`;
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.builder = (related as any).on(parent.getConnection());
    this.builder.where(this.typeColumn, this.getMorphType());
    this.builder.where(this.idColumn, this.parent.getAttribute(this.localKey));

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

  protected getMorphType(): string {
    const parentConstructor = getModelConstructor(this.parent);
    return parentConstructor.morphName || parentConstructor.name;
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  addEagerConstraints(models: Model[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey));
    this.builder.whereIn(this.idColumn, keys);
    this.builder.where(this.typeColumn, this.getMorphType());
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.idColumn];
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

  get(): Promise<Collection<T>> { return this.getResults(); }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getTable()}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(this.parent.getConnection()).select(aggregate);
    query.whereColumn(`${this.related.getTable()}.${this.idColumn}`, "=", `${parentTable}.${this.localKey}`);
    query.where(`${this.related.getTable()}.${this.typeColumn}`, this.getMorphType());
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, "1", callback).toSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, aggregate, callback).toSql();
  }
}

export class MorphToMany<T extends Model = Model> {
  protected builder: Builder<T>;
  protected parent: Model;
  protected related: ModelConstructor;
  protected name: string;
  protected table: string;
  protected foreignPivotKey: string;
  protected relatedPivotKey: string;
  protected parentKey: string;
  protected relatedKey: string;
  protected morphType: string;
  protected pivotWheres: Array<{ column: string; operator: string; value: any; boolean: "and" | "or" }> = [];

  protected decoratePivotQuery(builder: Builder<any>): Builder<any> & PivotQueryBuilder {
    const query = builder as Builder<any> & PivotQueryBuilder;
    const relation = this;

    const define = (name: keyof PivotQueryBuilder, fn: (...args: any[]) => any) => {
      if (!(name in query)) {
        Object.defineProperty(query, name, {
          configurable: true,
          enumerable: false,
          value: fn,
          writable: true,
        });
      }
    };

    define("wherePivot", (column: string, operator: string | any, value?: any) => {
      relation.applyPivotWhere(query, column, operator, value, "and");
      return query;
    });
    define("orWherePivot", (column: string, operator: string | any, value?: any) => {
      relation.applyPivotWhere(query, column, operator, value, "or");
      return query;
    });
    define("wherePivotIn", (column: string, values: any[]) => {
      relation.applyPivotWhere(query, column, "IN", values, "and");
      return query;
    });
    define("wherePivotNull", (column: string) => {
      relation.applyPivotWhere(query, column, "IS NULL", null, "and");
      return query;
    });

    return query;
  }

  constructor(
    parent: Model,
    related: ModelConstructor,
    name: string,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string,
    morphType?: string
  ) {
    const parentConstructor = getModelConstructor(parent);
    this.parent = parent;
    this.related = related;
    this.name = name;
    this.table = table || `${name}s`;
    this.parentKey = parentKey || parentConstructor.primaryKey;
    this.relatedKey = relatedKey || related.primaryKey;
    this.morphType = morphType || parentConstructor.morphName || parentConstructor.name;
    this.foreignPivotKey = foreignPivotKey || `${snakeCase(name)}_id`;
    this.relatedPivotKey = relatedPivotKey || `${snakeCase(related.name)}_id`;
    this.builder = (related as any).on(parent.getConnection());
    this.addConstraints();

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

  protected qualifiedPivotTable(): string {
    return this.parent.getConnection().qualifyTable(this.table);
  }

  protected applyStoredPivotWhere(builder: Builder<any>, where: { column: string; operator: string; value: any; boolean: "and" | "or" }): Builder<any> {
    if (where.operator === "IN") {
      builder.whereIn(where.column as any, where.value, where.boolean);
    } else if (where.operator === "IS NULL") {
      builder.whereNull(where.column as any, where.boolean);
    } else if (where.boolean === "or") {
      builder.orWhere(where.column as any, where.operator, where.value);
    } else {
      builder.where(where.column as any, where.operator, where.value);
    }
    return builder;
  }

  protected applyPivotWhere(builder: Builder<any>, column: string, operator: string | any, value?: any, boolean: "and" | "or" = "and"): Builder<any> {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    const entry = { column: `${this.table}.${column}`, operator, value, boolean };
    this.pivotWheres.push(entry);
    return this.applyStoredPivotWhere(builder, entry);
  }

  wherePivot(column: string, operator: string | any, value?: any): this {
    this.applyPivotWhere(this.builder, column, operator, value, "and");
    return this;
  }

  orWherePivot(column: string, operator: string | any, value?: any): this {
    this.applyPivotWhere(this.builder, column, operator, value, "or");
    return this;
  }

  wherePivotIn(column: string, values: any[]): this {
    this.applyPivotWhere(this.builder, column, "IN", values, "and");
    return this;
  }

  wherePivotNull(column: string): this {
    this.applyPivotWhere(this.builder, column, "IS NULL", null, "and");
    return this;
  }

  protected addConstraints(): void {
    const relatedTable = this.related.getTable();
    this.builder.select(`${relatedTable}.*`);
    this.builder.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.where(`${this.table}.${this.foreignPivotKey}`, this.parent.getAttribute(this.parentKey));
    this.builder.where(`${this.table}.${this.name}_type`, this.morphType);
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  addEagerConstraints(models: Model[]): void {
    const keys = models.map((m) => m.getAttribute(this.parentKey));
    const relatedTable = this.related.getTable();
    this.builder = this.decoratePivotQuery((this.related as any).on(this.parent.getConnection()));
    this.builder.select(`${relatedTable}.*`, `${this.table}.${this.foreignPivotKey}`);
    this.builder.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.whereIn(`${this.table}.${this.foreignPivotKey}`, keys);
    this.builder.where(`${this.table}.${this.name}_type`, this.morphType);
    for (const where of this.pivotWheres) {
      this.applyStoredPivotWhere(this.builder, where);
    }
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignPivotKey];
      if (!dictionary[key]) dictionary[key] = [];
      delete (result.$attributes as any)[this.foreignPivotKey];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.parentKey);
      model.setRelation(relationName, new Collection(dictionary[String(key)] || []));
    }
  }

  async getResults(): Promise<Collection<T>> {
    return this.builder.get();
  }

  get(): Promise<Collection<T>> { return this.getResults(); }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getTable()}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const relatedTable = this.related.getTable();
    const query = this.decoratePivotQuery((this.related as any).on(this.parent.getConnection()).select(aggregate));
    query.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    query.whereColumn(`${this.table}.${this.foreignPivotKey}`, "=", `${parentTable}.${this.parentKey}`);
    query.where(`${this.table}.${this.name}_type`, this.morphType);
    for (const where of this.pivotWheres) {
      this.applyStoredPivotWhere(query, where);
    }
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, "1", callback).toSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, aggregate, callback).toSql();
  }
}
