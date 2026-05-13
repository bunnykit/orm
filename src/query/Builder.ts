import { Connection } from "../connection/Connection.js";
import type { WhereClause, OrderClause, HavingClause, UnionClause } from "../types/index.js";
import type { EagerLoadDefinition, EagerLoadInput, Model, ModelAttributeInput, ModelColumn, ModelColumnValue, ModelConstructor, ModelRelationName, TypedEagerLoad, TypedConstraintMap, TypedConstraintSelection, TypedExistsConstraintMap, ExtractStringPaths, WithLoadedRelations, WithLoadedRelationsFromConstraintMap, WithRelationCount, WithRelationExists, WithRelationExistsMap, Relation, RelationConstraintQuery, NestedRelationPath, LiteralUnion, RelationRelatedModel } from "../model/Model.js";
import { findRelationMethod } from "../model/Model.js";
import { ModelNotFoundError } from "../model/ModelNotFoundError.js";
import { IdentityMap } from "../model/IdentityMap.js";
import { Collection, type CollectionJson } from "../support/Collection.js";

type RelationConstraint<TModel = any, TRelation extends string = string> = (query: RelationConstraintQuery<TModel, TRelation>) => void | Builder<any> | RelationConstraintQuery<TModel, TRelation>;
type ExistsConstraintMap<TResult> = Record<string, RelationConstraint<TResult, any> | undefined>;
type RelatedColumn<TResult, R extends string> = ModelColumn<RelationRelatedModel<TResult, R>>;
export interface PaginatorJson<T> {
  data: CollectionJson<T>;
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  from: number;
  to: number;
}

export class Paginator<T> {
  data: Collection<T>;
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  from: number;
  to: number;

  constructor(init: {
    data: Collection<T>;
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
    from: number;
    to: number;
  }) {
    this.data = init.data;
    this.current_page = init.current_page;
    this.per_page = init.per_page;
    this.total = init.total;
    this.last_page = init.last_page;
    this.from = init.from;
    this.to = init.to;
  }

  json(): PaginatorJson<T> {
    return {
      data: this.data.toJSON(),
      current_page: this.current_page,
      per_page: this.per_page,
      total: this.total,
      last_page: this.last_page,
      from: this.from,
      to: this.to,
    } as PaginatorJson<T>;
  }

  toJSON(): PaginatorJson<T> {
    return this.json();
  }
}

export class Builder<T = Record<string, any>, TResult = T> {
  connection: Connection;
  tableName: string;
  columns: string[] = ["*"];
  wheres: WhereClause[] = [];
  orders: OrderClause[] = [];
  groups: string[] = [];
  havings: HavingClause[] = [];
  limitValue?: number;
  offsetValue?: number;
  joins: string[] = [];
  distinctFlag = false;
  model?: ModelConstructor;
  eagerLoads: EagerLoadDefinition[] = [];
  randomOrderFlag = false;
  lockMode?: string;
  unions: UnionClause[] = [];
  fromRaw?: string;
  updateJoins: string[] = [];
  bindings: any[] = [];
  private parameterize = false;
  private sqlCache?: string;
  private booleanResultColumns = new Set<string>();

  constructor(connection: Connection, table: string) {
    this.connection = connection;
    this.tableName = table;
  }

  private get grammar() {
    return this.connection.getGrammar();
  }

  private invalidateSqlCache(): void {
    this.sqlCache = undefined;
  }

  private coerceBooleanResultColumns(row: any): any {
    for (const column of this.booleanResultColumns) {
      if (!(column in row)) continue;
      const value = row[column];
      row[column] = value === true || value === 1 || value === "1" || value === "t" || value === "true";
    }
    return row;
  }

  private parseRelationAlias(relation: string, defaultSuffix: string): { relationName: string; alias: string } {
    const match = relation.match(/^(.+?)\s+as\s+(.+)$/i);
    if (!match) return { relationName: relation, alias: `${relation}${defaultSuffix}` };
    return { relationName: match[1].trim(), alias: match[2].trim() };
  }

  private normalizeEagerLoads(relations: any[]): EagerLoadDefinition[] {
    const normalized: EagerLoadDefinition[] = [];
    const flattened = relations.flat() as any[];
    for (let i = 0; i < flattened.length; i++) {
      const relation = flattened[i];
      if (typeof relation === "string") {
        const next = flattened[i + 1];
        if (typeof next === "function") {
          normalized.push({ name: relation, constraint: next });
          i++;
        } else {
          normalized.push({ name: relation });
        }
      } else if ("name" in relation && typeof (relation as EagerLoadDefinition).name === "string") {
        normalized.push(relation as EagerLoadDefinition);
      } else {
        for (const [name, constraint] of Object.entries(relation) as [string, EagerLoadDefinition["constraint"]][]) {
          normalized.push({ name, constraint });
        }
      }
    }
    return normalized;
  }

  setModel(model: ModelConstructor): this {
    this.model = model;
    return this;
  }

  table(table: string): this {
    this.invalidateSqlCache();
    this.tableName = table;
    return this;
  }

  select(...columns: ModelColumn<T>[]): this {
    this.invalidateSqlCache();
    this.columns = columns;
    return this;
  }

  distinct(): this {
    this.invalidateSqlCache();
    this.distinctFlag = true;
    return this;
  }

  where(column: ModelColumn<T>, value: any): this;
  where(column: ModelColumn<T>, operator: string, value: any, boolean?: "and" | "or", scope?: string): this;
  where(column: ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any, boolean?: "and" | "or", scope?: string): this;
  where(column: ModelColumn<T> | ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any, boolean: "and" | "or" = "and", scope?: string): this {
    if (typeof column === "function") {
      return this.whereNested(column as (query: Builder<T>) => void, boolean);
    }

    if (typeof column === "object" && column !== null) {
      for (const [key, val] of Object.entries(column)) {
        this.where(key, "=", val, boolean, scope);
      }
      return this;
    }

    if (value === undefined) {
      value = operator;
      operator = "=";
    }

    this.invalidateSqlCache();
    this.wheres.push({ type: "basic", column, operator, value, boolean, scope });
    return this;
  }

  private whereNested(callback: (query: Builder<T>) => void, boolean: "and" | "or" = "and"): this {
    const nested = new Builder<T>(this.connection, this.tableName);
    callback(nested);
    if (nested.wheres.length > 0) {
      this.invalidateSqlCache();
      this.wheres.push({ type: "nested", column: "", query: nested.wheres, boolean, scope: undefined });
    }
    return this;
  }

  orWhere(column: ModelColumn<T>, value: any): this;
  orWhere(column: ModelColumn<T>, operator: string, value: any): this;
  orWhere(column: ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any): this;
  orWhere(column: ModelColumn<T> | ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any): this {
    return this.where(column as any, operator, value, "or");
  }

  whereNot(column: ModelColumn<T> | ModelAttributeInput<T>, value?: any, boolean: "and" | "or" = "and"): this {
    if (typeof column === "object" && column !== null) {
      for (const [key, val] of Object.entries(column)) {
        this.whereNot(key, val, boolean);
      }
      return this;
    }
    return this.where(column, "!=", value, boolean);
  }

  orWhereNot(column: ModelColumn<T> | ModelAttributeInput<T>, value?: any): this {
    return this.whereNot(column, value, "or");
  }

  whereIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "in", column, value: values, boolean, scope });
    return this;
  }

  whereNotIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "in", column, value: values, boolean, operator: "NOT IN" as any, scope });
    return this;
  }

  whereNull(column: ModelColumn<T>, boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "null", column, boolean, scope });
    return this;
  }

  whereNotNull(column: ModelColumn<T>, boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "null", column, boolean, operator: "NOT NULL" as any, scope });
    return this;
  }

  whereBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "between", column, value: values, boolean, scope });
    return this;
  }

  whereNotBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "between", column, value: values, boolean, operator: "NOT BETWEEN" as any, scope });
    return this;
  }

  whereDate(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("date", column, operator, value, boolean);
  }

  orWhereDate(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereDate(column, operator, value, "or");
  }

  whereDay(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("day", column, operator, value, boolean);
  }

  orWhereDay(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereDay(column, operator, value, "or");
  }

  whereMonth(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("month", column, operator, value, boolean);
  }

  orWhereMonth(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereMonth(column, operator, value, "or");
  }

  whereYear(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("year", column, operator, value, boolean);
  }

  orWhereYear(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereYear(column, operator, value, "or");
  }

  whereTime(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("time", column, operator, value, boolean);
  }

  orWhereTime(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereTime(column, operator, value, "or");
  }

  whereRaw(sql: string, boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "raw", column: sql, boolean, scope });
    return this;
  }

  whereColumn(first: string, operator: string, second: string, boolean: "and" | "or" = "and"): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "column", column: first, operator, value: second, boolean });
    return this;
  }

  whereExists(sql: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "exists", column: sql, boolean, operator: not ? "NOT EXISTS" : "EXISTS" });
    return this;
  }

  orWhereNull(column: ModelColumn<T>, scope?: string): this {
    return this.whereNull(column, "or", scope);
  }

  orWhereNotNull(column: ModelColumn<T>, scope?: string): this {
    return this.whereNotNull(column, "or", scope);
  }

  orWhereBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], scope?: string): this {
    return this.whereBetween(column, values, "or", scope);
  }

  orWhereNotBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], scope?: string): this {
    return this.whereNotBetween(column, values, "or", scope);
  }

  orWhereIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], scope?: string): this {
    return this.whereIn(column, values, "or", scope);
  }

  orWhereNotIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], scope?: string): this {
    return this.whereNotIn(column, values, "or", scope);
  }

  orWhereExists(sql: string): this {
    return this.whereExists(sql, "or");
  }

  orWhereNotExists(sql: string): this {
    return this.whereExists(sql, "or", true);
  }

  orWhereColumn(first: string, operator: string, second: string): this {
    return this.whereColumn(first, operator, second, "or");
  }

  orWhereRaw(sql: string, scope?: string): this {
    return this.whereRaw(sql, "or", scope);
  }

  whereJsonContains(column: ModelColumn<T>, value: any, boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "json_contains", column, value, boolean, scope: undefined, not });
    return this;
  }

  whereJsonLength(column: ModelColumn<T>, operator: string | number = "=", value?: number, boolean: "and" | "or" = "and", not: boolean = false): this {
    if (value === undefined) {
      value = operator as number;
      operator = "=";
    }
    this.invalidateSqlCache();
    this.wheres.push({ type: "json_length", column, operator: String(operator), value, boolean, scope: undefined, not });
    return this;
  }

  whereLike(column: ModelColumn<T>, value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "like", column, value, boolean, scope: undefined, not });
    return this;
  }

  whereNotLike(column: ModelColumn<T>, value: string): this {
    return this.whereLike(column, value, "and", true);
  }

  whereRegexp(column: ModelColumn<T>, value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "regexp", column, value, boolean, scope: undefined, not });
    return this;
  }

  whereFullText(columns: ModelColumn<T> | ModelColumn<T>[], value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.invalidateSqlCache();
    this.wheres.push({ type: "fulltext", column: "", columns: cols as string[], value, boolean, scope: undefined, not });
    return this;
  }

  whereAll(columns: ModelColumn<T>[], operator: string, value: any, boolean: "and" | "or" = "and"): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "all", column: "", columns: columns as string[], operator, value, boolean, scope: undefined });
    return this;
  }

  whereAny(columns: ModelColumn<T>[], operator: string, value: any, boolean: "and" | "or" = "and"): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "any", column: "", columns: columns as string[], operator, value, boolean, scope: undefined });
    return this;
  }

  orderBy(column: ModelColumn<T>, direction: "asc" | "desc" = "asc"): this {
    this.invalidateSqlCache();
    this.orders.push({ column, direction });
    return this;
  }

  latest(column: ModelColumn<T> = "created_at"): this {
    return this.orderBy(column, "desc");
  }

  oldest(column: ModelColumn<T> = "created_at"): this {
    return this.orderBy(column, "asc");
  }

  inRandomOrder(): this {
    this.invalidateSqlCache();
    this.randomOrderFlag = true;
    return this;
  }

  orderByDesc(column: ModelColumn<T>): this {
    return this.orderBy(column, "desc");
  }

  reorder(column?: ModelColumn<T>, direction: "asc" | "desc" = "asc"): this {
    this.invalidateSqlCache();
    this.orders = [];
    this.randomOrderFlag = false;
    if (column) {
      this.orderBy(column, direction);
    }
    return this;
  }

  groupBy(...columns: ModelColumn<T>[]): this {
    this.invalidateSqlCache();
    this.groups.push(...columns);
    return this;
  }

  having(column: ModelColumn<T>, operator: string, value: any): this {
    this.invalidateSqlCache();
    this.havings.push({ column, operator, value, boolean: "and" });
    return this;
  }

  orHaving(column: ModelColumn<T>, operator: string, value: any): this {
    this.invalidateSqlCache();
    this.havings.push({ column, operator, value, boolean: "or" });
    return this;
  }

  havingRaw(sql: string, boolean: "and" | "or" = "and"): this {
    this.invalidateSqlCache();
    this.havings.push({ sql, boolean });
    return this;
  }

  orHavingRaw(sql: string): this {
    return this.havingRaw(sql, "or");
  }

  limit(count: number): this {
    this.invalidateSqlCache();
    this.limitValue = count;
    return this;
  }

  offset(count: number): this {
    this.invalidateSqlCache();
    this.offsetValue = count;
    return this;
  }

  forPage(page: number, perPage: number = 15): this {
    return this.offset((page - 1) * perPage).limit(perPage);
  }

  join(table: string, first: string, operator: string, second: string, type: string = "INNER"): this {
    const joinSql = `${type} JOIN ${this.grammar.wrap(table)} ON ${this.grammar.wrap(first)} ${operator} ${this.grammar.wrap(second)}`;
    this.invalidateSqlCache();
    this.joins.push(joinSql);
    return this;
  }

  leftJoin(table: string, first: string, operator: string, second: string): this {
    return this.join(table, first, operator, second, "LEFT");
  }

  rightJoin(table: string, first: string, operator: string, second: string): this {
    return this.join(table, first, operator, second, "RIGHT");
  }

  crossJoin(table: string): this {
    this.invalidateSqlCache();
    this.joins.push(`CROSS JOIN ${this.grammar.wrap(table)}`);
    return this;
  }

  union(query: Builder<T> | string, all: boolean = false): this {
    const sql = typeof query === "string" ? query : query.toSql();
    this.invalidateSqlCache();
    this.unions.push({ query: sql, all });
    return this;
  }

  unionAll(query: Builder<T> | string): this {
    return this.union(query, true);
  }

  with<K extends string & NestedRelationPath<T>>(constraint: TypedConstraintSelection<T, K>): Builder<T, WithLoadedRelationsFromConstraintMap<TResult, TypedConstraintSelection<T, K>>>;
  with<R extends TypedConstraintMap<T> & object>(constraint: R): Builder<T, WithLoadedRelationsFromConstraintMap<TResult, R>>;
  with<R extends string & NestedRelationPath<T>>(relation: R): Builder<T, WithLoadedRelations<TResult, R>>;
  with(relation: LiteralUnion<string & NestedRelationPath<T>>): Builder<T, WithLoadedRelations<TResult, string>>;
  with<R extends string & NestedRelationPath<T>>(relation: R, callback: RelationConstraint<T, R>): Builder<T, WithLoadedRelations<TResult, R>>;
  with(relation: LiteralUnion<string & NestedRelationPath<T>>, callback: EagerLoadDefinition["constraint"]): Builder<T, WithLoadedRelations<TResult, string>>;
  with<Rs extends ReadonlyArray<TypedEagerLoad<T>>>(relations: Rs): Builder<T, WithLoadedRelations<TResult, ExtractStringPaths<Rs[number]>>>;
  with<Rs extends ReadonlyArray<TypedEagerLoad<T>>>(...relations: Rs): Builder<T, WithLoadedRelations<TResult, ExtractStringPaths<Rs[number]>>>;
  with(...relations: any[]): any {
    this.eagerLoads.push(...this.normalizeEagerLoads(relations as any));
    return this as any;
  }

  withoutGlobalScope(scope: string): this {
    this.invalidateSqlCache();
    this.wheres = this.wheres.filter((where) => where.scope !== scope);
    return this;
  }

  withoutGlobalScopes(): this {
    this.invalidateSqlCache();
    this.wheres = this.wheres.filter((where) => !where.scope);
    return this;
  }

  withTrashed(): this {
    return this.withoutGlobalScope("softDeletes");
  }

  onlyTrashed(): this {
    this.withTrashed();
    const model = this.model as any;
    if (model?.softDeletes) {
      this.whereNotNull(model.getQualifiedDeletedAtColumn());
    }
    return this;
  }

  scope(name: string, ...args: any[]): this {
    if (!this.model) {
      throw new Error(`Cannot apply scope "${name}" without a model`);
    }
    const method = `scope${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    const scope = (this.model as any)[method] || (this.model as any).scopes?.[name];
    if (typeof scope !== "function") {
      throw new Error(`Scope "${name}" is not defined on model ${(this.model as any).name}`);
    }
    const result = scope.call(this.model, this, ...args);
    return (result || this) as this;
  }

  when(condition: any, callback: (query: this) => void | this, defaultCallback?: (query: this) => void | this): this {
    if (condition) {
      const result = callback(this);
      return (result || this) as this;
    } else if (defaultCallback) {
      const result = defaultCallback(this);
      return (result || this) as this;
    }
    return this;
  }

  unless(condition: any, callback: (query: this) => void | this, defaultCallback?: (query: this) => void | this): this {
    return this.when(!condition, callback, defaultCallback);
  }

  tap(callback: (query: this) => void | this): this {
    const result = callback(this);
    return (result || this) as this;
  }

  has<R extends ModelRelationName<TResult>>(relationName: R, operator: string | RelationConstraint<TResult, R> = ">=", count: number = 1, callback?: RelationConstraint<TResult, R>): this {
    if (typeof operator === "function") {
      callback = operator;
      operator = ">=";
      count = 1;
    }
    const relation = this.getModelRelation(relationName);
    if (operator === ">=" && count === 1) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback));
    }
    if ((operator === "<" || operator === "=") && count <= 0) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback), "and", true);
    }
    return this.whereRaw(`(${relation.getRelationCountSql(this, callback)}) ${operator} ${this.grammar.escape(count)}`);
  }

  orHas<R extends ModelRelationName<TResult>>(relationName: R, operator: string | RelationConstraint<TResult, R> = ">=", count: number = 1, callback?: RelationConstraint<TResult, R>): this {
    if (typeof operator === "function") {
      callback = operator;
      operator = ">=";
      count = 1;
    }
    const relation = this.getModelRelation(relationName);
    if (operator === ">=" && count === 1) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback), "or");
    }
    if ((operator === "<" || operator === "=") && count <= 0) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback), "or", true);
    }
    return this.whereRaw(`(${relation.getRelationCountSql(this, callback)}) ${operator} ${this.grammar.escape(count)}`, "or");
  }

  whereHas<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>, operator: string = ">=", count: number = 1): this {
    return this.has(relationName, operator, count, callback);
  }

  orWhereHas<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>, operator: string = ">=", count: number = 1): this {
    return this.orHas(relationName, operator, count, callback);
  }

  whereRelation(relationName: string, column: ModelColumn<T>, operator: string | any, value?: any): this {
    return (this as any).whereHas(relationName, (q: Builder<any>) => {
      value === undefined ? q.where(column as any, operator) : q.where(column as any, operator, value);
    }) as this;
  }

  orWhereRelation(relationName: string, column: ModelColumn<T>, operator: string | any, value?: any): this {
    return (this as any).orWhereHas(relationName, (q: Builder<any>) => {
      value === undefined ? q.where(column as any, operator) : q.where(column as any, operator, value);
    }) as this;
  }

  withWhereHas<R extends TypedEagerLoad<T>>(
    relation: R,
    callback?: RelationConstraint<any, any>
  ): Builder<T, WithLoadedRelations<TResult, ExtractStringPaths<R>>> {
    this.whereHas(relation as string, callback);
    return (this as any).with(relation);
  }

  doesntHave<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>): this {
    return this.has(relationName, "<", 1, callback);
  }

  whereDoesntHave<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>): this {
    return this.doesntHave(relationName, callback);
  }

  withCount<R extends string & ModelRelationName<TResult>, A extends string | undefined = undefined>(relationName: R, alias?: A): Builder<T, WithRelationCount<TResult, R, A>>;
  withCount<A extends string | undefined = undefined>(relationName: LiteralUnion<string & ModelRelationName<TResult>>, alias?: A): Builder<T, WithRelationCount<TResult, string, A>>;
  withCount(relationName: string, alias?: string): any {
    const relation = this.getModelRelation(relationName);
    this.addSelect(`(${relation.getRelationCountSql(this)}) as ${alias || `${relationName}_count`}`);
    return this as any;
  }

  private addExistsSelect(relationName: string, alias: string, callback?: RelationConstraint<TResult, any>): void {
    const relation = this.getModelRelation(relationName);
    this.addSelect(`CASE WHEN EXISTS (${relation.getRelationExistenceSql(this, callback)}) THEN 1 ELSE 0 END as ${alias}`);
    this.booleanResultColumns.add(alias);
  }

  withExists<R extends TypedExistsConstraintMap<TResult> & object>(relations: R): Builder<T, WithRelationExistsMap<TResult, R>>;
  withExists<R extends ExistsConstraintMap<TResult>>(relations: R): Builder<T, WithRelationExistsMap<TResult, R>>;
  withExists<R extends string & NestedRelationPath<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>): Builder<T, WithRelationExists<TResult, R>>;
  withExists<R extends string>(relationName: R, callback?: RelationConstraint<any, any>): Builder<T, WithRelationExists<TResult, R>>;
  withExists<R extends string & NestedRelationPath<TResult>, A extends string>(relationName: R, alias: A, callback?: RelationConstraint<TResult, R>): Builder<T, WithRelationExists<TResult, R, A>>;
  withExists<R extends string, A extends string>(relationName: R, alias: A, callback?: RelationConstraint<any, any>): Builder<T, WithRelationExists<TResult, R, A>>;
  withExists(relationOrMap: any, aliasOrCallback?: any, callback?: any): any {
    if (typeof relationOrMap === "object" && relationOrMap !== null) {
      for (const [relation, constraint] of Object.entries(relationOrMap) as [string, RelationConstraint<TResult, any> | undefined][]) {
        const parsed = this.parseRelationAlias(relation, "_exists");
        this.addExistsSelect(parsed.relationName, parsed.alias, constraint);
      }
      return this;
    }

    const relationName = relationOrMap as string;
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    const constraint = typeof aliasOrCallback === "function" ? aliasOrCallback : callback;
    this.addExistsSelect(relationName, alias || `${relationName}_exists`, constraint);
    return this as any;
  }

  withSum<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withSum<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withSum<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withSum(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withSum(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withSum(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withSum(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "SUM", aliasOrCallback, callback);
  }

  withAvg<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withAvg<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withAvg<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withAvg(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withAvg(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withAvg(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withAvg(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "AVG", aliasOrCallback, callback);
  }

  withMin<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withMin<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withMin<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withMin(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withMin(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withMin(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withMin(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "MIN", aliasOrCallback, callback);
  }

  withMax<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withMax<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withMax<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withMax(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withMax(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withMax(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withMax(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "MAX", aliasOrCallback, callback);
  }

  addSelect(...columns: ModelColumn<T>[]): this {
    this.invalidateSqlCache();
    if (this.columns.length === 1 && this.columns[0] === "*") {
      this.columns = [`${this.tableName}.*`];
    }
    this.columns.push(...columns);
    return this;
  }

  selectRaw(sql: string): this {
    this.invalidateSqlCache();
    this.columns.push(sql);
    return this;
  }

  fromSub(query: Builder<any> | string, as: string): this {
    const sql = typeof query === "string" ? query : query.toSql();
    this.invalidateSqlCache();
    this.fromRaw = `(${sql}) AS ${this.grammar.wrap(as)}`;
    return this;
  }

  updateFrom(table: string, first: string, operator: string, second: string): this {
    this.invalidateSqlCache();
    this.updateJoins.push(`INNER JOIN ${this.grammar.wrap(table)} ON ${this.grammar.wrap(first)} ${operator} ${this.grammar.wrap(second)}`);
    return this;
  }

  clone(): Builder<T> {
    const cloned = new Builder<T>(this.connection, this.tableName);
    cloned.columns = [...this.columns];
    cloned.wheres = [...this.wheres];
    cloned.orders = [...this.orders];
    cloned.groups = [...this.groups];
    cloned.havings = [...this.havings];
    cloned.limitValue = this.limitValue;
    cloned.offsetValue = this.offsetValue;
    cloned.joins = [...this.joins];
    cloned.distinctFlag = this.distinctFlag;
    cloned.model = this.model;
    cloned.eagerLoads = [...this.eagerLoads];
    cloned.randomOrderFlag = this.randomOrderFlag;
    cloned.lockMode = this.lockMode;
    cloned.unions = [...this.unions];
    cloned.fromRaw = this.fromRaw;
    cloned.updateJoins = [...this.updateJoins];
    cloned.bindings = [...this.bindings];
    cloned.parameterize = this.parameterize;
    cloned.booleanResultColumns = new Set(this.booleanResultColumns);
    return cloned;
  }

  wrapColumn(value: string): string {
    return this.grammar.wrap(value);
  }

  escapeValue(value: any): string {
    return this.grammar.escape(value);
  }

  private addBinding(value: any): string {
    this.bindings.push(value);
    return this.grammar.placeholder(this.bindings.length);
  }

  private compileWhereClause(where: WhereClause, prefix: string): string {
    if (where.type === "basic") {
      const value = this.parameterize ? this.addBinding(where.value) : this.grammar.escape(where.value);
      return `${prefix} ${this.grammar.wrap(where.column)} ${where.operator} ${value}`;
    } else if (where.type === "in") {
      const op = where.operator === "NOT IN" ? "NOT IN" : "IN";
      const values = this.parameterize
        ? (where.value as any[]).map((v: any) => this.addBinding(v)).join(", ")
        : (where.value as any[]).map((v: any) => this.grammar.escape(v)).join(", ");
      return `${prefix} ${this.grammar.wrap(where.column)} ${op} (${values})`;
    } else if (where.type === "null") {
      const op = where.operator === "NOT NULL" ? "IS NOT NULL" : "IS NULL";
      return `${prefix} ${this.grammar.wrap(where.column)} ${op}`;
    } else if (where.type === "between") {
      const op = where.operator === "NOT BETWEEN" ? "NOT BETWEEN" : "BETWEEN";
      const low = this.parameterize ? this.addBinding((where.value as any[])[0]) : this.grammar.escape((where.value as any[])[0]);
      const high = this.parameterize ? this.addBinding((where.value as any[])[1]) : this.grammar.escape((where.value as any[])[1]);
      return `${prefix} ${this.grammar.wrap(where.column)} ${op} ${low} AND ${high}`;
    } else if (where.type === "raw") {
      return `${prefix} ${where.column}`;
    } else if (where.type === "nested") {
      const sql = this.compileWhereClauses(where.query || [], "");
      return `${prefix} (${sql})`;
    } else if (where.type === "like") {
      const sql = this.grammar.compileLike(this.grammar.wrap(where.column), where.value as string, !!where.not, this.parameterize ? (v) => this.addBinding(v) : undefined);
      return `${prefix} ${sql}`;
    } else if (where.type === "regexp") {
      const sql = this.grammar.compileRegexp(this.grammar.wrap(where.column), where.value as string, !!where.not, this.parameterize ? (v) => this.addBinding(v) : undefined);
      return `${prefix} ${sql}`;
    } else if (where.type === "fulltext") {
      const cols = (where.columns || []).map((c) => this.grammar.wrap(c));
      let sql = this.grammar.compileFullText(cols, where.value as string, this.parameterize ? (v) => this.addBinding(v) : undefined);
      if (where.not) sql = `NOT (${sql})`;
      return `${prefix} ${sql}`;
    } else if (where.type === "json_contains") {
      let sql = this.grammar.compileJsonContains(this.grammar.wrap(where.column), where.value, this.parameterize ? (v) => this.addBinding(v) : undefined);
      if (where.not) sql = `NOT (${sql})`;
      return `${prefix} ${sql}`;
    } else if (where.type === "json_length") {
      let sql = this.grammar.compileJsonLength(this.grammar.wrap(where.column), where.operator || "=", where.value, this.parameterize ? (v) => this.addBinding(v) : undefined);
      if (where.not) sql = `NOT (${sql})`;
      return `${prefix} ${sql}`;
    } else if (where.type === "date") {
      const sql = this.grammar.compileDateWhere(where.dateType || "date", this.grammar.wrap(where.column), where.operator || "=", where.value, this.parameterize ? (v) => this.addBinding(v) : undefined);
      return `${prefix} ${sql}`;
    } else if (where.type === "all") {
      const cols = (where.columns || []).map((c) => this.grammar.wrap(c));
      const inner = cols.map((c) => {
        const val = this.parameterize ? this.addBinding(where.value) : this.grammar.escape(where.value);
        return `${c} ${where.operator} ${val}`;
      }).join(" AND ");
      return `${prefix} (${inner})`;
    } else if (where.type === "any") {
      const cols = (where.columns || []).map((c) => this.grammar.wrap(c));
      const inner = cols.map((c) => {
        const val = this.parameterize ? this.addBinding(where.value) : this.grammar.escape(where.value);
        return `${c} ${where.operator} ${val}`;
      }).join(" OR ");
      return `${prefix} (${inner})`;
    } else if (where.type === "column") {
      return `${prefix} ${this.grammar.wrap(where.column)} ${where.operator} ${this.grammar.wrap(where.value)}`;
    } else if (where.type === "exists") {
      return `${prefix} ${where.operator} (${where.column})`;
    }
    return "";
  }

  private compileWheres(): string {
    return this.compileWhereClauses(this.wheres, "WHERE");
  }

  private compileWhereClauses(wheres: WhereClause[], firstPrefix: string): string {
    if (wheres.length === 0) return "";
    const clauses = wheres.map((where, index) => {
      const prefix = index === 0 ? "WHERE" : where.boolean.toUpperCase();
      const adjustedPrefix = index === 0 ? firstPrefix : prefix;
      return this.compileWhereClause(where, adjustedPrefix);
    });
    return clauses.join(" ").trim();
  }

  private compileOrders(): string {
    if (this.randomOrderFlag) {
      return this.grammar.compileRandomOrder();
    }
    if (this.orders.length === 0) return "";
    return `ORDER BY ${this.orders.map((o) => `${this.grammar.wrap(o.column)} ${o.direction.toUpperCase()}`).join(", ")}`;
  }

  private compileGroups(): string {
    if (this.groups.length === 0) return "";
    return `GROUP BY ${this.groups.map((c) => this.grammar.wrap(c)).join(", ")}`;
  }

  private compileHavings(): string {
    if (this.havings.length === 0) return "";
    const clauses = this.havings.map((h, index) => {
      const prefix = index === 0 ? "" : h.boolean.toUpperCase() + " ";
      if (h.sql) {
        return prefix + h.sql;
      }
      const value = this.parameterize ? this.addBinding(h.value) : this.grammar.escape(h.value);
      return prefix + `${this.grammar.wrap(h.column!)} ${h.operator} ${value}`;
    });
    return `HAVING ${clauses.join(" ")}`;
  }

  private compileLimit(): string {
    if (this.limitValue === undefined) return "";
    return `LIMIT ${this.limitValue}`;
  }

  private compileOffset(): string {
    if (this.offsetValue === undefined) return "";
    return this.grammar.compileOffset(this.offsetValue, this.limitValue);
  }

  private compileColumns(): string {
    return this.columns.map((c) => (this.isRawColumn(c) ? c : this.grammar.wrap(c))).join(", ");
  }

  private isRawColumn(column: string): boolean {
    return column.includes("(") || /\s+as\s+/i.test(column) || /^[0-9]+$/.test(column);
  }

  toSql(): string {
    if (!this.parameterize && this.sqlCache) return this.sqlCache;
    const distinct = this.distinctFlag ? "DISTINCT " : "";
    const from = this.fromRaw || this.grammar.wrap(this.tableName);
    let sql = `SELECT ${distinct}${this.compileColumns()} FROM ${from}`;
    if (this.joins.length > 0) sql += " " + this.joins.join(" ");
    sql += " " + this.compileWheres();
    sql += " " + this.compileGroups();
    sql += " " + this.compileHavings();
    sql += " " + this.compileOrders();
    sql += " " + this.compileLimit();
    sql += " " + this.compileOffset();
    sql += this.grammar.compileLock(this.lockMode);
    for (const union of this.unions) {
      sql += ` UNION${union.all ? " ALL" : ""} ${union.query}`;
    }
    const compiled = sql.replace(/\s+/g, " ").trim();
    if (!this.parameterize) this.sqlCache = compiled;
    return compiled;
  }

  toSqlWithEagerLoads(models: Model[]): string {
    if (!this.model || this.eagerLoads.length === 0) return this.toSql();
    if (models.length === 0) throw new Error("toSqlWithEagerLoads requires at least one model");

    const queries: string[] = [this.toSql()];

    for (const eagerLoad of this.eagerLoads) {
      const relationName = eagerLoad.name;
      const relationMethod = findRelationMethod(this.model!, relationName);
      if (!relationMethod) continue;

      const firstModel = models[0];
      const relation = relationMethod.call(firstModel) as Relation<any>;

      relation.addEagerConstraints(models);
      queries.push(relation.getQuery().toSql());
    }

    return queries.join(";\n");
  }

  async get(): Promise<Collection<TResult>> {
    this.bindings = [];
    this.parameterize = true;
    const sql = this.toSql();
    this.parameterize = false;
    const results = await this.connection.query(sql, this.bindings);
    const rows = Array.from(results).map((row: any) => this.coerceBooleanResultColumns(row));

    if (this.model) {
      const identityMap = IdentityMap.current();
      const table = (this.model as any).getTable();
      const primaryKey = (this.model as any).primaryKey || "id";

      const models = rows.map((row: any) => {
        if (identityMap) {
          const pk = row[primaryKey];
          if (pk !== null && pk !== undefined) {
            const cached = IdentityMap.get(table, pk);
            if (cached) {
              for (const column of this.booleanResultColumns) {
                if (column in row) {
                  (cached.$attributes as any)[column] = row[column];
                }
              }
              return cached as T;
            }
          }
        }

        const instance = (this.model as any).hydrate(row, this.connection);

        if (identityMap) {
          const pk = row[primaryKey];
          if (pk !== null && pk !== undefined) {
            IdentityMap.set(table, pk, instance);
          }
        }

        return instance as T;
      });

      if (this.eagerLoads.length > 0) {
        await (this.model as any).eagerLoadRelations(models, this.eagerLoads);
      }

      return new Collection(models) as unknown as Collection<TResult>;
    }

    return new Collection(rows as T[]) as unknown as Collection<TResult>;
  }

  async getArray(): Promise<TResult[]> {
    return (await this.get()).all();
  }

  async json(): Promise<CollectionJson<TResult>> {
    return (await this.get()).toJSON();
  }

  async first(): Promise<TResult | null> {
    return (await this.limit(1).get())[0] || null;
  }

  async find(id: any, column: ModelColumn<T> = "id"): Promise<TResult | null> {
    return this.where(column, id).first();
  }

  async findOrFail(id: any, column: ModelColumn<T> = "id"): Promise<TResult> {
    const result = await this.find(id, column);
    if (!result) {
      throw new ModelNotFoundError(this.model?.name || "Model", id);
    }
    return result;
  }

  async firstOrFail(): Promise<TResult> {
    const result = await this.first();
    if (!result) {
      throw new ModelNotFoundError(this.model?.name || "Model");
    }
    return result;
  }

  async firstOrCreate(attributes: ModelAttributeInput<T> = {}, values: ModelAttributeInput<T> = {}): Promise<T> {
    const found = await this.clone().where(attributes as any).first();
    if (found) return found;
    if (!this.model) {
      throw new Error("firstOrCreate requires a model to be set on the builder");
    }
    const instance = new (this.model as any)({ ...attributes, ...values });
    if (typeof instance.setConnection === "function") {
      instance.setConnection(this.connection);
    }
    await instance.save();
    return instance;
  }

  async updateOrCreate(attributes: ModelAttributeInput<T>, values: ModelAttributeInput<T> = {}): Promise<T> {
    const found = await this.clone().where(attributes as any).first();
    if (found) {
      const model = found as any;
      if (typeof model.fill === "function") {
        model.fill(values);
        await model.save();
      }
      return found;
    }
    if (!this.model) {
      throw new Error("updateOrCreate requires a model to be set on the builder");
    }
    const instance = new (this.model as any)({ ...attributes, ...values });
    if (typeof instance.setConnection === "function") {
      instance.setConnection(this.connection);
    }
    await instance.save();
    return instance;
  }

  async pluck<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K>[]> {
    const model = this.model;
    this.model = undefined as any;
    this.bindings = [];
    this.parameterize = true;
    const sql = this.select(column as any).toSql();
    this.parameterize = false;
    const rows = await this.connection.query(sql, this.bindings);
    this.model = model;
    return Array.from(rows).map((row: any) => row[column as string]);
  }

  private async aggregate(sql: string, alias: string): Promise<any> {
    const query = this.clone();
    query.model = undefined;
    query.columns = [`${sql} as ${alias}`];
    query.orders = [];
    query.limitValue = undefined;
    query.offsetValue = undefined;
    query.eagerLoads = [];
    query.lockMode = undefined;
    query.invalidateSqlCache();
    const result = await query.first();
    return result ? (result as any)[alias] : null;
  }

  async count(column: ModelColumn<T> | "*" = "*"): Promise<number> {
    const countSql = column === "*" ? "COUNT(*)" : `COUNT(${this.grammar.wrap(column as string)})`;
    this.bindings = [];
    this.parameterize = true;
    const from = this.fromRaw || this.grammar.wrap(this.tableName);
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = `SELECT ${countSql} as cnt FROM ${from}${whereSql ? " " + whereSql : ""}`;
    const rows = await this.connection.query(sql, this.bindings);
    return rows.length > 0 ? Number((rows[0] as any).cnt) : 0;
  }

  async sum(column: ModelColumn<T>): Promise<number> {
    const sql = `SELECT SUM(${this.grammar.wrap(column as string)}) as sum_val FROM ${this.fromRaw || this.grammar.wrap(this.tableName)}`;
    this.bindings = [];
    this.parameterize = true;
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const fullSql = whereSql ? `${sql}${whereSql}` : sql;
    const rows = await this.connection.query(fullSql, this.bindings);
    return rows.length > 0 ? Number((rows[0] as any).sum_val || 0) : 0;
  }

  async avg(column: ModelColumn<T>): Promise<number> {
    const sql = `SELECT AVG(${this.grammar.wrap(column as string)}) as avg_val FROM ${this.fromRaw || this.grammar.wrap(this.tableName)}`;
    this.bindings = [];
    this.parameterize = true;
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const fullSql = whereSql ? `${sql}${whereSql}` : sql;
    const rows = await this.connection.query(fullSql, this.bindings);
    return rows.length > 0 ? Number((rows[0] as any).avg_val || 0) : 0;
  }

  async min<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K> | null> {
    const sql = `SELECT MIN(${this.grammar.wrap(column as string)}) as min_val FROM ${this.fromRaw || this.grammar.wrap(this.tableName)}`;
    this.bindings = [];
    this.parameterize = true;
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const fullSql = whereSql ? `${sql}${whereSql}` : sql;
    const rows = await this.connection.query(fullSql, this.bindings);
    return rows.length > 0 ? (rows[0] as any).min_val : null;
  }

  async max<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K> | null> {
    const sql = `SELECT MAX(${this.grammar.wrap(column as string)}) as max_val FROM ${this.fromRaw || this.grammar.wrap(this.tableName)}`;
    this.bindings = [];
    this.parameterize = true;
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const fullSql = whereSql ? `${sql}${whereSql}` : sql;
    const rows = await this.connection.query(fullSql, this.bindings);
    return rows.length > 0 ? (rows[0] as any).max_val : null;
  }

  async paginate(perPage: number = 15, page: number = 1): Promise<Paginator<TResult>> {
    const countQuery = this.clone();
    countQuery.limitValue = undefined;
    countQuery.offsetValue = undefined;
    countQuery.orders = [];
    countQuery.invalidateSqlCache();
    const total = await countQuery.count();
    const data = await this.clone().forPage(page, perPage).get() as unknown as Collection<TResult>;
    return new Paginator({
      data,
      current_page: page,
      per_page: perPage,
      total,
      last_page: Math.max(1, Math.ceil(total / perPage)),
      from: total === 0 ? 0 : (page - 1) * perPage + 1,
      to: total === 0 ? 0 : Math.min(page * perPage, total),
    });
  }

  async chunk(count: number, callback: (items: Collection<TResult>) => void | Promise<void>): Promise<void> {
    let page = 1;
    while (true) {
      const items = await this.clone().forPage(page, count).get() as unknown as Collection<TResult>;
      if (items.length === 0) break;
      await callback(items);
      if (items.length < count) break;
      page++;
    }
  }

  async each(count: number, callback: (item: TResult) => void | Promise<void>): Promise<void> {
    await this.chunk(count, async (items) => {
      for (const item of items) {
        await callback(item);
      }
    });
  }

  async chunkById(count: number, callback: (items: Collection<TResult>) => void | Promise<void>, column?: ModelColumn<T>): Promise<void> {
    const model = this.model;
    const idColumn = column ?? ((model ? (model as any).primaryKey : null) || "id") as ModelColumn<T>;
    const qualifiedColumn = String(idColumn).includes(".") ? String(idColumn) : `${this.tableName}.${String(idColumn)}`;
    const accessColumn = String(idColumn).includes(".") ? String(idColumn).split(".").at(-1)! : String(idColumn);
    let lastId: any = null;

    while (true) {
      const builder = this.clone().orderBy(qualifiedColumn as ModelColumn<T>, "asc").limit(count);
      if (lastId !== null) {
        builder.where(qualifiedColumn as ModelColumn<T>, ">", lastId);
      }
      const items = await builder.get() as unknown as Collection<TResult>;
      if (items.length === 0) break;
      await callback(items);
      const last = items[items.length - 1];
      lastId = last && typeof last === "object" ? (last as any)[accessColumn] ?? (last as any).getAttribute?.(accessColumn) ?? null : null;
      if (items.length < count || lastId === null) break;
    }
  }

  async eachById(count: number, callback: (item: TResult) => void | Promise<void>, column?: ModelColumn<T>): Promise<void> {
    await this.chunkById(count, async (items) => {
      for (const item of items) {
        await callback(item);
      }
    }, column);
  }

  async *cursor(chunkSize: number = 1000): AsyncGenerator<T> {
    const model = this.model;
    const primaryKey = model ? (model as any).primaryKey || "id" : "id";

    // Cursor pagination is incompatible with random ordering
    if (this.randomOrderFlag) {
      throw new Error("cursor() does not support inRandomOrder(). Use lazy() instead.");
    }

    const orderColumn = this.orders[0]?.column || primaryKey;
    const orderDirection = this.orders[0]?.direction || "asc";

    let lastValues: any[] | undefined = undefined;

    while (true) {
      const builder = this.clone();
      // Preserve multi-column ORDER BY, appending PK tie-breaker if not present
      builder.orders = this.orders.length > 0 ? [...this.orders] : [{ column: orderColumn, direction: orderDirection as "asc" | "desc" }];
      const hasPkOrder = builder.orders.some((o) => o.column === primaryKey);
      if (!hasPkOrder) {
        builder.orders.push({ column: primaryKey, direction: orderDirection as "asc" | "desc" });
      }
      builder.offsetValue = undefined;
      builder.limitValue = chunkSize;

      if (lastValues !== undefined) {
        // Parenthesize existing wheres when appending cursor condition to preserve OR precedence
        if (builder.wheres.length > 0) {
          const hasOr = builder.wheres.some((w) => w.boolean === "or");
          if (hasOr) {
            builder.wheres = [{ type: "nested", column: "", query: builder.wheres, boolean: "and", scope: undefined }];
          }
        }
        builder.wheres.push({ type: "nested", column: "", query: this.compileCursorWheres(builder.orders, lastValues), boolean: "and", scope: undefined });
      }

      const items = await builder.get();
      if (items.length === 0) break;

      for (const item of items) {
        yield item;
      }

      if (items.length < chunkSize) break;

      const lastItem = items[items.length - 1];
      lastValues = lastItem && typeof lastItem === "object"
        ? builder.orders.map((order) => (lastItem as any)[this.getResultAccessColumn(order.column)])
        : undefined;
    }
  }

  private getResultAccessColumn(column: string): string {
    return column.includes(".") ? column.split(".").at(-1)! : column;
  }

  private compileCursorWheres(orders: OrderClause[], values: any[], index: number = 0): WhereClause[] {
    const order = orders[index];
    const op = order.direction === "asc" ? ">" : "<";
    const clauses: WhereClause[] = [{
      type: "basic",
      column: order.column,
      operator: op,
      value: values[index],
      boolean: "and",
      scope: undefined,
    }];

    if (index < orders.length - 1) {
      clauses.push({
        type: "nested",
        column: "",
        query: [
          {
            type: "basic",
            column: order.column,
            operator: "=",
            value: values[index],
            boolean: "and",
            scope: undefined,
          },
          ...this.compileCursorWheres(orders, values, index + 1),
        ],
        boolean: "or",
        scope: undefined,
      });
    }

    return clauses;
  }

  async *lazy(count: number = 1000): AsyncGenerator<T> {
    let page = 1;
    while (true) {
      const items = await this.clone().forPage(page, count).get();
      if (items.length === 0) break;
      for (const item of items) {
        yield item;
      }
      if (items.length < count) break;
      page++;
    }
  }

  async insert(data: ModelAttributeInput<T> | ModelAttributeInput<T>[]): Promise<any> {
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) return;

    const columns = this.getUniformColumns(records);
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    const sql = `INSERT INTO ${this.grammar.wrap(this.tableName)} (${columns.map((c) => this.grammar.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;
    return await this.connection.run(sql, bindings);
  }

  async insertGetId(data: ModelAttributeInput<T>, idColumn: ModelColumn<T> = "id"): Promise<any> {
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) return null;

    const columns = this.getUniformColumns(records);
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    let sql = `INSERT INTO ${this.grammar.wrap(this.tableName)} (${columns.map((c) => this.grammar.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;

    if (this.connection.getDriverName() === "postgres") {
      sql += ` RETURNING ${this.grammar.wrap(idColumn)}`;
      const result = await this.connection.query(sql, bindings);
      return result[0]?.[idColumn] ?? null;
    }

    const result = await this.connection.run(sql, bindings);
    return (result as any)?.lastInsertRowid ?? (result as any)?.insertId ?? null;
  }

  async insertOrIgnore(data: ModelAttributeInput<T> | ModelAttributeInput<T>[]): Promise<any> {
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) return;

    const columns = this.getUniformColumns(records);
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    const sql = this.grammar.compileInsertOrIgnore(
      this.grammar.wrap(this.tableName),
      columns,
      values
    );
    return await this.connection.run(sql, bindings);
  }

  async upsert(data: ModelAttributeInput<T> | ModelAttributeInput<T>[], uniqueBy: ModelColumn<T> | ModelColumn<T>[], updateColumns?: ModelColumn<T>[]): Promise<any> {
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) return;

    const columns = this.getUniformColumns(records);
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    const uniqueCols = Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy];
    const updateCols = updateColumns ?? columns.filter((c) => !uniqueCols.includes(c));

    const sql = this.grammar.compileUpsert(
      this.grammar.wrap(this.tableName),
      columns,
      values,
      uniqueCols,
      updateCols
    );
    return await this.connection.run(sql, bindings);
  }

  private getUniformColumns(records: ModelAttributeInput<T>[]): string[] {
    const columns = Object.keys(records[0]);
    const signature = [...columns].sort().join("\0");
    for (let i = 1; i < records.length; i++) {
      const recordSignature = Object.keys(records[i]).sort().join("\0");
      if (recordSignature !== signature) {
        throw new Error("Bulk insert records must have the same columns.");
      }
    }
    return columns;
  }

  async update(data: ModelAttributeInput<T>): Promise<any> {
    this.bindings = [];
    this.parameterize = true;
    const sets = Object.entries(data).map(([key, value]) => {
      this.bindings.push(value);
      return `${this.grammar.wrap(key)} = ${this.grammar.placeholder(this.bindings.length)}`;
    });
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = this.grammar.compileUpdate(
      this.grammar.wrap(this.tableName),
      sets,
      whereSql,
      this.updateJoins
    );
    return await this.connection.run(sql, this.bindings);
  }

  async delete(): Promise<any> {
    this.bindings = [];
    this.parameterize = true;
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = this.grammar.compileDelete(
      this.grammar.wrap(this.tableName),
      whereSql,
      this.updateJoins,
      this.limitValue
    );
    return await this.connection.run(sql, this.bindings);
  }

  async increment(column: ModelColumn<T>, amount: number = 1, extra: ModelAttributeInput<T> = {}): Promise<any> {
    this.bindings = [];
    this.parameterize = true;
    const sets = [`${this.grammar.wrap(column)} = ${this.grammar.wrap(column)} + ${amount}`];
    for (const [key, value] of Object.entries(extra)) {
      this.bindings.push(value);
      sets.push(`${this.grammar.wrap(key)} = ${this.grammar.placeholder(this.bindings.length)}`);
    }
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = `UPDATE ${this.grammar.wrap(this.tableName)} SET ${sets.join(", ")} ${whereSql}`;
    return await this.connection.run(sql.trim(), this.bindings);
  }

  async decrement(column: ModelColumn<T>, amount: number = 1, extra: ModelAttributeInput<T> = {}): Promise<any> {
    return this.increment(column, -amount, extra);
  }

  async restore(): Promise<any> {
    const model = this.model as any;
    if (!model?.softDeletes) {
      throw new Error("restore() is only available for soft deleting models");
    }
    return this.withTrashed().update({ [model.deletedAtColumn]: null } as any);
  }

  async exists(): Promise<boolean> {
    this.bindings = [];
    this.parameterize = true;
    const from = this.fromRaw || this.grammar.wrap(this.tableName);
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = `SELECT 1 FROM ${from}${whereSql ? whereSql : ""} LIMIT 1`;
    const rows = await this.connection.query(sql, this.bindings);
    return rows.length > 0;
  }

  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  async sole(): Promise<TResult> {
    const results = await this.limit(2).get();
    if (results.length === 0) {
      throw new ModelNotFoundError(this.model?.name || "Model");
    }
    if (results.length > 1) {
      throw new Error("Multiple records found when only one was expected.");
    }
    return results[0];
  }

  async value<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K> | null> {
    const result = await this.first();
    return result ? (result as any)[column] : null;
  }

  dump(): this {
    console.log(this.toSql());
    return this;
  }

  dd(): never {
    console.log(this.toSql());
    throw new Error("dd() called — execution halted.");
  }

  async explain(): Promise<any[]> {
    this.bindings = [];
    this.parameterize = true;
    const sql = this.grammar.compileExplain(this.toSql());
    this.parameterize = false;
    const results = await this.connection.query(sql, this.bindings);
    return Array.from(results);
  }

  take(count: number): this {
    return this.limit(count);
  }

  skip(count: number): this {
    return this.offset(count);
  }

  lockForUpdate(): this {
    const driver = this.connection.getDriverName();
    if (driver !== "sqlite") {
      this.invalidateSqlCache();
      this.lockMode = "FOR UPDATE";
    }
    return this;
  }

  sharedLock(): this {
    const driver = this.connection.getDriverName();
    if (driver === "mysql") {
      this.invalidateSqlCache();
      this.lockMode = "LOCK IN SHARE MODE";
    } else if (driver === "postgres") {
      this.invalidateSqlCache();
      this.lockMode = "FOR SHARE";
    }
    return this;
  }

  skipLocked(): this {
    if (this.lockMode) {
      this.invalidateSqlCache();
      this.lockMode += " SKIP LOCKED";
    }
    return this;
  }

  noWait(): this {
    if (this.lockMode) {
      this.invalidateSqlCache();
      this.lockMode += " NOWAIT";
    }
    return this;
  }

  private addDateWhere(type: string, column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    this.invalidateSqlCache();
    this.wheres.push({ type: "date", column: column as string, operator, value, boolean, scope: undefined, dateType: type });
    return this;
  }

  private getModelRelation(relationName: string): any {
    if (!this.model) {
      throw new Error(`Cannot query relation "${relationName}" without a model`);
    }
    const instance = new (this.model as any)();
    const relation = instance[relationName]?.();
    if (!relation) {
      throw new Error(`Relation "${relationName}" is not defined on model ${(this.model as any).name}`);
    }
    return relation;
  }

  private withAggregate(
    relationName: string,
    column: string,
    fn: string,
    aliasOrCallback?: string | RelationConstraint<any, any>,
    callback?: RelationConstraint<any, any>
  ): this {
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    const constraint = typeof aliasOrCallback === "function" ? aliasOrCallback : callback;
    const relation = this.getModelRelation(relationName);
    const defaultAlias = `${relationName}_${fn.toLowerCase()}_${column.replace(/\W+/g, "_")}`;
    this.addSelect(`(${relation.getRelationAggregateSql(this, `${fn}(${relation.qualifyRelatedColumn(column)})`, constraint)}) as ${alias || defaultAlias}`);
    return this;
  }
}
