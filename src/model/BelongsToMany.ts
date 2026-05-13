import { Builder } from "../query/Builder.js";
import { Schema } from "../schema/Schema.js";
import { Collection } from "../support/Collection.js";
import { snakeCase } from "../utils.js";
import type { Model, ModelConstructor, PivotQueryBuilder } from "./Model.js";

function getModelConstructor(model: Model): typeof Model {
  return Object.getPrototypeOf(model).constructor as typeof Model;
}

function defaultPivotTable(parent: Model, related: ModelConstructor): string {
  const names = [snakeCase(getModelConstructor(parent).name), snakeCase(related.name)].sort();
  return `${names[0]}_${names[1]}`;
}

export class BelongsToMany<T extends Model = Model> {
  protected parent: Model;
  protected related: ModelConstructor;
  protected table: string;
  protected foreignPivotKey: string;
  protected relatedPivotKey: string;
  protected parentKey: string;
  protected relatedKey: string;
  protected pivotColumns: string[] = [];
  protected pivotTimestamps = false;
  protected builder: Builder<T>;
  protected pivotWheres: Array<{ column: string; operator: string; value: any; boolean: "and" | "or" }> = [];
  protected pivotAccessor = "pivot";

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

  as(accessor: string): this {
    this.pivotAccessor = accessor;
    return this;
  }

  withPivot(...columns: (string | string[])[]): this {
    const cols = columns.flat();
    this.pivotColumns.push(...cols);
    this.builder.addSelect(...cols.map((c) => `${this.table}.${c}`) as any);
    return this;
  }

  withTimestamps(): this {
    this.pivotTimestamps = true;
    this.builder.addSelect(`${this.table}.created_at` as any, `${this.table}.updated_at` as any);
    return this;
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

  protected qualifiedPivotTable(): string {
    return this.parent.getConnection().qualifyTable(this.table);
  }

  protected getPivotSelectColumns(): string[] {
    const pivot = [...this.pivotColumns];
    if (this.pivotTimestamps) {
      pivot.push("created_at", "updated_at");
    }
    return pivot.map((col) => `${this.table}.${col}`);
  }

  protected getPivotColumnName(column: string): string {
    return column.startsWith(`${this.table}.`) ? column.slice(this.table.length + 1) : column;
  }

  protected getDefaultPivotAttributes(): Record<string, any> {
    const defaults: Record<string, any> = {};

    for (const where of this.pivotWheres) {
      if (where.boolean !== "and") continue;

      const column = this.getPivotColumnName(where.column);
      if (where.operator === "=") {
        defaults[column] = where.value;
      } else if (where.operator === "IS NULL") {
        defaults[column] = null;
      }
    }

    return defaults;
  }

  protected applyPivotWheres(builder: Builder<any>): Builder<any> {
    for (const w of this.pivotWheres) {
      this.applyStoredPivotWhere(builder, w);
    }

    return builder;
  }

  protected async shouldAutoGeneratePivotPrimaryKey(primaryKey: string): Promise<boolean> {
    const column = await Schema.getColumn(this.table, primaryKey);
    if (!column) return false;
    if (!column.primary) return false;
    if (column.autoIncrement) return false;

    const type = String(column.type || "").toLowerCase();
    const numericTypes = new Set(["integer", "int", "bigint", "smallint", "tinyint", "real", "float", "double", "decimal", "numeric"]);
    return !numericTypes.has(type);
  }

  protected attachPivotToResults(results: Collection<any>): void {
    if (this.pivotColumns.length === 0 && !this.pivotTimestamps) return;
    const pivotCols = this.getPivotSelectColumns().map((col) => col.replace(`${this.table}.`, ""));
    for (const result of results) {
      const pivot: Record<string, any> = {};
      for (const col of pivotCols) {
        pivot[col] = (result.$attributes as any)[col];
        delete (result.$attributes as any)[col];
      }
      (result as any)[this.pivotAccessor] = pivot;
    }
  }

  constructor(
    parent: Model,
    related: ModelConstructor,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ) {
    const parentConstructor = getModelConstructor(parent);
    this.parent = parent;
    this.related = related;
    this.table = table || defaultPivotTable(parent, related);
    this.parentKey = parentKey || parentConstructor.primaryKey;
    this.relatedKey = relatedKey || related.primaryKey;
    this.foreignPivotKey = foreignPivotKey || `${snakeCase(parentConstructor.name)}_id`;
    this.relatedPivotKey = relatedPivotKey || `${snakeCase(related.name)}_id`;
    this.builder = this.decoratePivotQuery((related as any).on(parent.getConnection()));
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

  protected addConstraints(): void {
    const relatedTable = this.related.getTable();
    const pivotSelect = this.getPivotSelectColumns();
    const columns = [`${relatedTable}.*`, ...pivotSelect];
    this.builder.select(...columns);
    this.builder.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.where(`${this.table}.${this.foreignPivotKey}`, this.parent.getAttribute(this.parentKey));
  }

  getQuery(): Builder<T> {
    return this.decoratePivotQuery(this.builder);
  }

  addEagerConstraints(models: Model[]): void {
    const keys = models.map((m) => m.getAttribute(this.parentKey));
    this.builder = this.decoratePivotQuery((this.related as any).on(this.parent.getConnection()));
    const relatedTable = this.related.getTable();
    const pivotSelect = this.getPivotSelectColumns();
    this.builder.select(`${relatedTable}.*`, `${this.table}.${this.foreignPivotKey}`, ...pivotSelect);
    this.builder.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.whereIn(`${this.table}.${this.foreignPivotKey}`, keys);
    this.applyPivotWheres(this.builder);
  }

  async getEager(): Promise<Collection<any>> {
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    const pivotCols = this.getPivotSelectColumns().map((col) => col.replace(`${this.table}.`, ""));
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignPivotKey];
      if (!dictionary[key]) dictionary[key] = [];
      delete (result.$attributes as any)[this.foreignPivotKey];
      const pivot: Record<string, any> = {};
      for (const col of pivotCols) {
        pivot[col] = (result.$attributes as any)[col];
        delete (result.$attributes as any)[col];
      }
      if (Object.keys(pivot).length > 0) {
        (result as any)[this.pivotAccessor] = pivot;
      }
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.parentKey);
      model.setRelation(relationName, new Collection(dictionary[key] || []));
    }
  }

  async getResults(): Promise<Collection<T>> {
    const results = await this.builder.get();
    this.attachPivotToResults(results);
    return results;
  }

  get(): Promise<Collection<T>> { return this.getResults(); }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getTable()}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const relatedTable = this.related.getTable();
    const query = this.decoratePivotQuery((this.related as any).on(this.parent.getConnection()).select(aggregate));
    query.join(
      this.table,
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    query.whereColumn(`${this.table}.${this.foreignPivotKey}`, "=", `${parentTable}.${this.parentKey}`);
    this.applyPivotWheres(query);
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

  async attach(ids: any | any[], attributes?: Record<string, any>): Promise<any> {
    const idList = Array.isArray(ids) ? ids : [ids];
    const pivotAttributes = {
      ...this.getDefaultPivotAttributes(),
      ...attributes,
    };
    const records = idList.map((id) => ({
      [this.foreignPivotKey]: this.parent.getAttribute(this.parentKey),
      [this.relatedPivotKey]: id,
      ...pivotAttributes,
    }));

    const pk = "id";
    const needsUuid = await this.shouldAutoGeneratePivotPrimaryKey(pk);

    for (const record of records) {
      if (needsUuid && !record[pk]) {
        record[pk] = crypto.randomUUID();
      }
    }

    const connection = this.parent.getConnection();
    const builder = new Builder(connection, connection.qualifyTable(this.table));

    if (idList.length === 1) {
      if (needsUuid) {
        await builder.insert(records[0]);
        return records[0][pk];
      }
      return await builder.insertGetId(records[0]);
    }

    await builder.insert(records);
    return;
  }

  async detach(ids?: any | any[]): Promise<void> {
    const connection = this.parent.getConnection();
    const builder = new Builder(connection, connection.qualifyTable(this.table))
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey));
    this.applyPivotWheres(builder);
    if (ids !== undefined) {
      builder.whereIn(this.relatedPivotKey, Array.isArray(ids) ? ids : [ids]);
    }
    await builder.delete();
  }

  async sync(ids: any | any[], attributes?: Record<string, any>, detachMissing: boolean = true): Promise<{ attached: any[]; detached: any[] }> {
    const idList = Array.isArray(ids) ? ids : [ids];
    const connection = this.parent.getConnection();
    const currentQuery = new Builder(connection, connection.qualifyTable(this.table))
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey));
    this.applyPivotWheres(currentQuery);
    const current = await currentQuery.pluck(this.relatedPivotKey);

    const currentSet = new Set(current);
    const newSet = new Set(idList);

    if (detachMissing) {
      const toDetach = current.filter((id) => !newSet.has(id));
      if (toDetach.length > 0) await this.detach(toDetach);
      const toAttach = idList.filter((id) => !currentSet.has(id));
      if (toAttach.length > 0) await this.attach(toAttach, attributes);
      return { attached: toAttach, detached: toDetach };
    }

    const toAttach = idList.filter((id) => !currentSet.has(id));
    if (toAttach.length > 0) await this.attach(toAttach, attributes);
    return { attached: toAttach, detached: [] };
  }

  async updateExistingPivot(id: any, attributes: Record<string, any>): Promise<void> {
    const connection = this.parent.getConnection();
    const builder = new Builder(connection, connection.qualifyTable(this.table))
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
      .where(this.relatedPivotKey, id);
    this.applyPivotWheres(builder);
    await builder.update(attributes);
  }

  async syncWithoutDetaching(ids: any | any[], attributes?: Record<string, any>): Promise<{ attached: any[]; detached: any[] }> {
    return this.sync(ids, attributes, false);
  }

  async toggle(ids: any | any[], attributes?: Record<string, any>): Promise<{ attached: any[]; detached: any[] }> {
    const idList = Array.isArray(ids) ? ids : [ids];
    const connection = this.parent.getConnection();
    const currentQuery = new Builder(connection, connection.qualifyTable(this.table))
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey));
    this.applyPivotWheres(currentQuery);
    const current = await currentQuery.pluck(this.relatedPivotKey);

    const currentSet = new Set(current);
    const toDetach = idList.filter((id) => currentSet.has(id));
    const toAttach = idList.filter((id) => !currentSet.has(id));

    if (toDetach.length > 0) await this.detach(toDetach);
    if (toAttach.length > 0) await this.attach(toAttach, attributes);

    return { attached: toAttach, detached: toDetach };
  }
}
