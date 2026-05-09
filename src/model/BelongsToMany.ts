import { Builder } from "../query/Builder.js";
import { snakeCase } from "../utils.js";
import type { Model, ModelConstructor } from "./Model.js";

function defaultPivotTable(parent: Model, related: typeof Model): string {
  const names = [snakeCase(parent.constructor.name), snakeCase(related.name)].sort();
  return `${names[0]}_${names[1]}`;
}

export class BelongsToMany<T extends Model = Model> {
  protected parent: Model;
  protected related: typeof Model;
  protected table: string;
  protected foreignPivotKey: string;
  protected relatedPivotKey: string;
  protected parentKey: string;
  protected relatedKey: string;
  protected builder: Builder<T>;

  constructor(
    parent: Model,
    related: typeof Model,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ) {
    this.parent = parent;
    this.related = related;
    this.table = table || defaultPivotTable(parent, related);
    this.parentKey = parentKey || (parent.constructor as typeof Model).primaryKey;
    this.relatedKey = relatedKey || related.primaryKey;
    this.foreignPivotKey = foreignPivotKey || `${snakeCase(parent.constructor.name)}_id`;
    this.relatedPivotKey = relatedPivotKey || `${snakeCase(related.name)}_id`;
    this.builder = (related as any).on(parent.getConnection());
    this.addConstraints();
  }

  protected addConstraints(): void {
    const relatedTable = this.related.getTable();
    this.builder.select(`${relatedTable}.*`);
    this.builder.join(
      this.table,
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.where(`${this.table}.${this.foreignPivotKey}`, this.parent.getAttribute(this.parentKey));
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  addEagerConstraints(models: Model[]): void {
    const keys = models.map((m) => m.getAttribute(this.parentKey));
    this.builder = (this.related as any).on(this.parent.getConnection());
    const relatedTable = this.related.getTable();
    this.builder.select(`${relatedTable}.*`, `${this.table}.${this.foreignPivotKey}`);
    this.builder.join(
      this.table,
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.whereIn(`${this.table}.${this.foreignPivotKey}`, keys);
  }

  async getEager(): Promise<any[]> {
    return this.builder.get();
  }

  match(models: Model[], results: any[], relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignPivotKey];
      if (!dictionary[key]) dictionary[key] = [];
      delete (result.$attributes as any)[this.foreignPivotKey];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.parentKey);
      model.setRelation(relationName, dictionary[key] || []);
    }
  }

  async getResults(): Promise<T[]> {
    return this.builder.get();
  }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getTable()}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const relatedTable = this.related.getTable();
    const query = (this.related as any).on(this.parent.getConnection()).select(aggregate);
    query.join(
      this.table,
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    query.whereColumn(`${this.table}.${this.foreignPivotKey}`, "=", `${parentTable}.${this.parentKey}`);
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

  async attach(ids: any | any[], attributes?: Record<string, any>): Promise<void> {
    const idList = Array.isArray(ids) ? ids : [ids];
    const records = idList.map((id) => ({
      [this.foreignPivotKey]: this.parent.getAttribute(this.parentKey),
      [this.relatedPivotKey]: id,
      ...attributes,
    }));
    const connection = this.parent.getConnection();
    await new Builder(connection, connection.qualifyTable(this.table)).insert(records);
  }

  async detach(ids?: any | any[]): Promise<void> {
    const connection = this.parent.getConnection();
    const builder = new Builder(connection, connection.qualifyTable(this.table))
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey));
    if (ids !== undefined) {
      builder.whereIn(this.relatedPivotKey, Array.isArray(ids) ? ids : [ids]);
    }
    await builder.delete();
  }

  async sync(ids: any | any[], detachMissing: boolean = true): Promise<void> {
    const idList = Array.isArray(ids) ? ids : [ids];
    const connection = this.parent.getConnection();
    const current = await new Builder(connection, connection.qualifyTable(this.table))
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
      .pluck(this.relatedPivotKey);

    const currentSet = new Set(current);
    const newSet = new Set(idList);

    if (detachMissing) {
      const toDetach = current.filter((id) => !newSet.has(id));
      if (toDetach.length > 0) await this.detach(toDetach);
    }

    const toAttach = idList.filter((id) => !currentSet.has(id));
    if (toAttach.length > 0) await this.attach(toAttach);
  }
}
