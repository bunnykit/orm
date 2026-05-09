import { Connection } from "../connection/Connection.js";
import type { WhereClause, OrderClause, HavingClause, UnionClause } from "../types/index.js";
import type { Model } from "../model/Model.js";
import { ModelNotFoundError } from "../model/ModelNotFoundError.js";

type RelationConstraint = (query: Builder<any>) => void | Builder<any>;

export interface Paginator<T> {
  data: T[];
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  from: number;
  to: number;
}

export class Builder<T = Record<string, any>> {
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
  model?: typeof Model;
  eagerLoads: string[] = [];
  randomOrderFlag = false;
  lockMode?: string;
  unions: UnionClause[] = [];
  fromRaw?: string;
  updateJoins: string[] = [];

  constructor(connection: Connection, table: string) {
    this.connection = connection;
    this.tableName = table;
  }

  private get grammar() {
    return this.connection.getGrammar();
  }

  setModel(model: typeof Model): this {
    this.model = model;
    return this;
  }

  table(table: string): this {
    this.tableName = table;
    return this;
  }

  select(...columns: string[]): this {
    this.columns = columns;
    return this;
  }

  distinct(): this {
    this.distinctFlag = true;
    return this;
  }

  where(column: string | Record<string, any> | ((query: Builder<T>) => void), operator?: string | any, value?: any, boolean: "and" | "or" = "and", scope?: string): this {
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

    this.wheres.push({ type: "basic", column, operator, value, boolean, scope });
    return this;
  }

  private whereNested(callback: (query: Builder<T>) => void, boolean: "and" | "or" = "and"): this {
    const nested = new Builder<T>(this.connection, this.tableName);
    callback(nested);
    if (nested.wheres.length > 0) {
      const sql = this.compileNestedWheres(nested);
      this.wheres.push({ type: "raw", column: `(${sql})`, boolean, scope: undefined });
    }
    return this;
  }

  orWhere(column: string | Record<string, any> | ((query: Builder<T>) => void), operator?: string | any, value?: any): this {
    return this.where(column as any, operator, value, "or");
  }

  whereNot(column: string | Record<string, any>, value?: any, boolean: "and" | "or" = "and"): this {
    if (typeof column === "object" && column !== null) {
      for (const [key, val] of Object.entries(column)) {
        this.whereNot(key, val, boolean);
      }
      return this;
    }
    return this.where(column, "!=", value, boolean);
  }

  orWhereNot(column: string | Record<string, any>, value?: any): this {
    return this.whereNot(column, value, "or");
  }

  whereIn(column: string, values: any[], boolean: "and" | "or" = "and", scope?: string): this {
    this.wheres.push({ type: "in", column, value: values, boolean, scope });
    return this;
  }

  whereNotIn(column: string, values: any[], boolean: "and" | "or" = "and", scope?: string): this {
    this.wheres.push({ type: "in", column, value: values, boolean, operator: "NOT IN" as any, scope });
    return this;
  }

  whereNull(column: string, boolean: "and" | "or" = "and", scope?: string): this {
    this.wheres.push({ type: "null", column, boolean, scope });
    return this;
  }

  whereNotNull(column: string, boolean: "and" | "or" = "and", scope?: string): this {
    this.wheres.push({ type: "null", column, boolean, operator: "NOT NULL" as any, scope });
    return this;
  }

  whereBetween(column: string, values: [any, any], boolean: "and" | "or" = "and", scope?: string): this {
    this.wheres.push({ type: "between", column, value: values, boolean, scope });
    return this;
  }

  whereNotBetween(column: string, values: [any, any], boolean: "and" | "or" = "and", scope?: string): this {
    this.wheres.push({ type: "between", column, value: values, boolean, operator: "NOT BETWEEN" as any, scope });
    return this;
  }

  whereDate(column: string, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("date", column, operator, value, boolean);
  }

  orWhereDate(column: string, operator?: string | any, value?: any): this {
    return this.whereDate(column, operator, value, "or");
  }

  whereDay(column: string, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("day", column, operator, value, boolean);
  }

  orWhereDay(column: string, operator?: string | any, value?: any): this {
    return this.whereDay(column, operator, value, "or");
  }

  whereMonth(column: string, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("month", column, operator, value, boolean);
  }

  orWhereMonth(column: string, operator?: string | any, value?: any): this {
    return this.whereMonth(column, operator, value, "or");
  }

  whereYear(column: string, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("year", column, operator, value, boolean);
  }

  orWhereYear(column: string, operator?: string | any, value?: any): this {
    return this.whereYear(column, operator, value, "or");
  }

  whereTime(column: string, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("time", column, operator, value, boolean);
  }

  orWhereTime(column: string, operator?: string | any, value?: any): this {
    return this.whereTime(column, operator, value, "or");
  }

  whereRaw(sql: string, boolean: "and" | "or" = "and", scope?: string): this {
    this.wheres.push({ type: "raw", column: sql, boolean, scope });
    return this;
  }

  whereColumn(first: string, operator: string, second: string, boolean: "and" | "or" = "and"): this {
    this.wheres.push({ type: "column", column: first, operator, value: second, boolean });
    return this;
  }

  whereExists(sql: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    this.wheres.push({ type: "exists", column: sql, boolean, operator: not ? "NOT EXISTS" : "EXISTS" });
    return this;
  }

  orWhereNull(column: string, scope?: string): this {
    return this.whereNull(column, "or", scope);
  }

  orWhereNotNull(column: string, scope?: string): this {
    return this.whereNotNull(column, "or", scope);
  }

  orWhereBetween(column: string, values: [any, any], scope?: string): this {
    return this.whereBetween(column, values, "or", scope);
  }

  orWhereNotBetween(column: string, values: [any, any], scope?: string): this {
    return this.whereNotBetween(column, values, "or", scope);
  }

  orWhereIn(column: string, values: any[], scope?: string): this {
    return this.whereIn(column, values, "or", scope);
  }

  orWhereNotIn(column: string, values: any[], scope?: string): this {
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

  whereJsonContains(column: string, value: any, boolean: "and" | "or" = "and", not: boolean = false): this {
    let sql = this.grammar.compileJsonContains(this.grammar.wrap(column), value);
    if (not) sql = `NOT (${sql})`;
    this.wheres.push({ type: "raw", column: sql, boolean, scope: undefined });
    return this;
  }

  whereJsonLength(column: string, operator: string | number = "=", value?: number, boolean: "and" | "or" = "and", not: boolean = false): this {
    if (value === undefined) {
      value = operator as number;
      operator = "=";
    }
    let sql = this.grammar.compileJsonLength(this.grammar.wrap(column), String(operator), value);
    if (not) sql = `NOT (${sql})`;
    this.wheres.push({ type: "raw", column: sql, boolean, scope: undefined });
    return this;
  }

  whereLike(column: string, value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    const sql = this.grammar.compileLike(this.grammar.wrap(column), value, not);
    this.wheres.push({ type: "raw", column: sql, boolean, scope: undefined });
    return this;
  }

  whereNotLike(column: string, value: string): this {
    return this.whereLike(column, value, "and", true);
  }

  whereRegexp(column: string, value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    const sql = this.grammar.compileRegexp(this.grammar.wrap(column), value, not);
    this.wheres.push({ type: "raw", column: sql, boolean, scope: undefined });
    return this;
  }

  whereFullText(columns: string | string[], value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    let sql = this.grammar.compileFullText(cols.map((c) => this.grammar.wrap(c)), value);
    if (not) sql = `NOT (${sql})`;
    this.wheres.push({ type: "raw", column: sql, boolean, scope: undefined });
    return this;
  }

  whereAll(columns: string[], operator: string, value: any, boolean: "and" | "or" = "and"): this {
    const sql = columns.map((c) => `${this.grammar.wrap(c)} ${operator} ${this.grammar.escape(value)}`).join(" AND ");
    this.wheres.push({ type: "raw", column: `(${sql})`, boolean, scope: undefined });
    return this;
  }

  whereAny(columns: string[], operator: string, value: any, boolean: "and" | "or" = "and"): this {
    const sql = columns.map((c) => `${this.grammar.wrap(c)} ${operator} ${this.grammar.escape(value)}`).join(" OR ");
    this.wheres.push({ type: "raw", column: `(${sql})`, boolean, scope: undefined });
    return this;
  }

  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.orders.push({ column, direction });
    return this;
  }

  latest(column: string = "created_at"): this {
    return this.orderBy(column, "desc");
  }

  oldest(column: string = "created_at"): this {
    return this.orderBy(column, "asc");
  }

  inRandomOrder(): this {
    this.randomOrderFlag = true;
    return this;
  }

  orderByDesc(column: string): this {
    return this.orderBy(column, "desc");
  }

  reorder(column?: string, direction: "asc" | "desc" = "asc"): this {
    this.orders = [];
    this.randomOrderFlag = false;
    if (column) {
      this.orderBy(column, direction);
    }
    return this;
  }

  groupBy(...columns: string[]): this {
    this.groups.push(...columns);
    return this;
  }

  having(column: string, operator: string, value: any): this {
    this.havings.push({ sql: `${this.grammar.wrap(column)} ${operator} ${this.grammar.escape(value)}`, boolean: "and" });
    return this;
  }

  orHaving(column: string, operator: string, value: any): this {
    this.havings.push({ sql: `${this.grammar.wrap(column)} ${operator} ${this.grammar.escape(value)}`, boolean: "or" });
    return this;
  }

  havingRaw(sql: string, boolean: "and" | "or" = "and"): this {
    this.havings.push({ sql, boolean });
    return this;
  }

  orHavingRaw(sql: string): this {
    return this.havingRaw(sql, "or");
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  offset(count: number): this {
    this.offsetValue = count;
    return this;
  }

  forPage(page: number, perPage: number = 15): this {
    return this.offset((page - 1) * perPage).limit(perPage);
  }

  join(table: string, first: string, operator: string, second: string, type: string = "INNER"): this {
    const joinSql = `${type} JOIN ${this.grammar.wrap(table)} ON ${this.grammar.wrap(first)} ${operator} ${this.grammar.wrap(second)}`;
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
    this.joins.push(`CROSS JOIN ${this.grammar.wrap(table)}`);
    return this;
  }

  union(query: Builder<T> | string, all: boolean = false): this {
    const sql = typeof query === "string" ? query : query.toSql();
    this.unions.push({ query: sql, all });
    return this;
  }

  unionAll(query: Builder<T> | string): this {
    return this.union(query, true);
  }

  with(...relations: string[]): this {
    this.eagerLoads.push(...relations);
    return this;
  }

  withoutGlobalScope(scope: string): this {
    this.wheres = this.wheres.filter((where) => where.scope !== scope);
    return this;
  }

  withoutGlobalScopes(): this {
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

  has(relationName: string, operator: string | RelationConstraint = ">=", count: number = 1, callback?: RelationConstraint): this {
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

  orHas(relationName: string, operator: string | RelationConstraint = ">=", count: number = 1, callback?: RelationConstraint): this {
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

  whereHas(relationName: string, callback?: RelationConstraint, operator: string = ">=", count: number = 1): this {
    return this.has(relationName, operator, count, callback);
  }

  orWhereHas(relationName: string, callback?: RelationConstraint, operator: string = ">=", count: number = 1): this {
    return this.orHas(relationName, operator, count, callback);
  }

  doesntHave(relationName: string, callback?: RelationConstraint): this {
    return this.has(relationName, "<", 1, callback);
  }

  whereDoesntHave(relationName: string, callback?: RelationConstraint): this {
    return this.doesntHave(relationName, callback);
  }

  withCount(relationName: string, alias?: string): this {
    const relation = this.getModelRelation(relationName);
    this.addSelect(`(${relation.getRelationCountSql(this)}) as ${alias || `${relationName}_count`}`);
    return this;
  }

  withSum(relationName: string, column: string, alias?: string): this {
    return this.withAggregate(relationName, column, "SUM", alias);
  }

  withAvg(relationName: string, column: string, alias?: string): this {
    return this.withAggregate(relationName, column, "AVG", alias);
  }

  withMin(relationName: string, column: string, alias?: string): this {
    return this.withAggregate(relationName, column, "MIN", alias);
  }

  withMax(relationName: string, column: string, alias?: string): this {
    return this.withAggregate(relationName, column, "MAX", alias);
  }

  addSelect(...columns: string[]): this {
    if (this.columns.length === 1 && this.columns[0] === "*") {
      this.columns = [`${this.tableName}.*`];
    }
    this.columns.push(...columns);
    return this;
  }

  selectRaw(sql: string): this {
    this.columns.push(sql);
    return this;
  }

  fromSub(query: Builder<any> | string, as: string): this {
    const sql = typeof query === "string" ? query : query.toSql();
    this.fromRaw = `(${sql}) AS ${this.grammar.wrap(as)}`;
    return this;
  }

  updateFrom(table: string, first: string, operator: string, second: string): this {
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
    return cloned;
  }

  wrapColumn(value: string): string {
    return this.grammar.wrap(value);
  }

  escapeValue(value: any): string {
    return this.grammar.escape(value);
  }

  private compileWhereClause(where: WhereClause, prefix: string): string {
    if (where.type === "basic") {
      return `${prefix} ${this.grammar.wrap(where.column)} ${where.operator} ${this.grammar.escape(where.value)}`;
    } else if (where.type === "in") {
      const op = where.operator === "NOT IN" ? "NOT IN" : "IN";
      return `${prefix} ${this.grammar.wrap(where.column)} ${op} (${where.value.map((v: any) => this.grammar.escape(v)).join(", ")})`;
    } else if (where.type === "null") {
      const op = where.operator === "NOT NULL" ? "IS NOT NULL" : "IS NULL";
      return `${prefix} ${this.grammar.wrap(where.column)} ${op}`;
    } else if (where.type === "between") {
      const op = where.operator === "NOT BETWEEN" ? "NOT BETWEEN" : "BETWEEN";
      return `${prefix} ${this.grammar.wrap(where.column)} ${op} ${this.grammar.escape(where.value[0])} AND ${this.grammar.escape(where.value[1])}`;
    } else if (where.type === "raw") {
      return `${prefix} ${where.column}`;
    } else if (where.type === "column") {
      return `${prefix} ${this.grammar.wrap(where.column)} ${where.operator} ${this.grammar.wrap(where.value)}`;
    } else if (where.type === "exists") {
      return `${prefix} ${where.operator} (${where.column})`;
    }
    return "";
  }

  private compileWheres(): string {
    if (this.wheres.length === 0) return "";
    const clauses = this.wheres.map((where, index) => {
      const prefix = index === 0 ? "WHERE" : where.boolean.toUpperCase();
      return this.compileWhereClause(where, prefix);
    });
    return clauses.join(" ");
  }

  private compileNestedWheres(builder: Builder<any>): string {
    if (builder.wheres.length === 0) return "";
    const clauses = builder.wheres.map((where, index) => {
      const prefix = index === 0 ? "" : where.boolean.toUpperCase();
      return this.compileWhereClause(where, prefix);
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
      return prefix + h.sql;
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
    return sql.replace(/\s+/g, " ").trim();
  }

  async get(): Promise<T[]> {
    const results = await this.connection.query(this.toSql());
    const rows = Array.from(results);

    if (this.model) {
      const models = rows.map((row: any) => {
        const instance = new (this.model as any)(row);
        instance.$exists = true;
        instance.$original = { ...row };
        if (typeof instance.setConnection === "function") {
          instance.setConnection(this.connection);
        }
        return instance as T;
      });

      if (this.eagerLoads.length > 0) {
        await (this.model as any).eagerLoadRelations(models, this.eagerLoads);
      }

      return models;
    }

    return rows as T[];
  }

  async first(): Promise<T | null> {
    const results = await this.limit(1).get();
    return results[0] || null;
  }

  async find(id: any, column: string = "id"): Promise<T | null> {
    return this.where(column, id).first();
  }

  async findOrFail(id: any, column: string = "id"): Promise<T> {
    const result = await this.find(id, column);
    if (!result) {
      throw new ModelNotFoundError(this.model?.name || "Model", id);
    }
    return result;
  }

  async firstOrFail(): Promise<T> {
    const result = await this.first();
    if (!result) {
      throw new ModelNotFoundError(this.model?.name || "Model");
    }
    return result;
  }

  async firstOrCreate(attributes: Partial<T> = {}, values: Partial<T> = {}): Promise<T> {
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

  async updateOrCreate(attributes: Partial<T>, values: Partial<T> = {}): Promise<T> {
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

  async pluck(column: string): Promise<any[]> {
    const results = await this.select(column).get();
    return results.map((row: any) => row[column]);
  }

  private async aggregate(sql: string, alias: string): Promise<any> {
    const model = this.model;
    this.model = undefined;
    const result = await this.select(`${sql} as ${alias}`).first();
    this.model = model;
    return result ? (result as any)[alias] : null;
  }

  async count(column: string = "*"): Promise<number> {
    return Number(await this.aggregate(`COUNT(${column})`, "count") ?? 0);
  }

  async sum(column: string): Promise<number> {
    return Number(await this.aggregate(`SUM(${column})`, "sum") ?? 0);
  }

  async avg(column: string): Promise<number> {
    return Number(await this.aggregate(`AVG(${column})`, "avg") ?? 0);
  }

  async min(column: string): Promise<any> {
    return await this.aggregate(`MIN(${column})`, "min");
  }

  async max(column: string): Promise<any> {
    return await this.aggregate(`MAX(${column})`, "max");
  }

  async paginate(perPage: number = 15, page: number = 1): Promise<Paginator<T>> {
    const total = await this.clone().count();
    const data = await this.clone().forPage(page, perPage).get();
    return {
      data,
      current_page: page,
      per_page: perPage,
      total,
      last_page: Math.max(1, Math.ceil(total / perPage)),
      from: total === 0 ? 0 : (page - 1) * perPage + 1,
      to: total === 0 ? 0 : Math.min(page * perPage, total),
    };
  }

  async chunk(count: number, callback: (items: T[]) => void | Promise<void>): Promise<void> {
    let page = 1;
    while (true) {
      const items = await this.clone().forPage(page, count).get();
      if (items.length === 0) break;
      await callback(items);
      if (items.length < count) break;
      page++;
    }
  }

  async each(count: number, callback: (item: T) => void | Promise<void>): Promise<void> {
    await this.chunk(count, async (items) => {
      for (const item of items) {
        await callback(item);
      }
    });
  }

  async *cursor(): AsyncGenerator<T> {
    let offset = 0;
    while (true) {
      const items = await this.clone().offset(offset).limit(1).get();
      if (items.length === 0) break;
      yield items[0];
      offset++;
    }
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

  async insert(data: Partial<T> | Partial<T>[]): Promise<any> {
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) return;

    const columns = Object.keys(records[0]);
    const values = records.map((record) => {
      return `(${columns.map((col) => this.grammar.escape((record as any)[col])).join(", ")})`;
    });

    const sql = `INSERT INTO ${this.grammar.wrap(this.tableName)} (${columns.map((c) => this.grammar.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;
    return await this.connection.run(sql);
  }

  async insertGetId(data: Partial<T>, idColumn: string = "id"): Promise<any> {
    const result = await this.insert(data);
    return (result as any)?.lastInsertRowid ?? (result as any)?.insertId ?? null;
  }

  async insertOrIgnore(data: Partial<T> | Partial<T>[]): Promise<any> {
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) return;

    const columns = Object.keys(records[0]);
    const values = records.map((record) => {
      return `(${columns.map((col) => this.grammar.escape((record as any)[col])).join(", ")})`;
    });

    const sql = this.grammar.compileInsertOrIgnore(
      this.grammar.wrap(this.tableName),
      columns,
      values
    );
    return await this.connection.run(sql);
  }

  async upsert(data: Partial<T> | Partial<T>[], uniqueBy: string | string[], updateColumns?: string[]): Promise<any> {
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) return;

    const columns = Object.keys(records[0]);
    const values = records.map((record) => {
      return `(${columns.map((col) => this.grammar.escape((record as any)[col])).join(", ")})`;
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
    return await this.connection.run(sql);
  }

  async update(data: Partial<T>): Promise<any> {
    const sets = Object.entries(data)
      .map(([key, value]) => `${this.grammar.wrap(key)} = ${this.grammar.escape(value)}`)
      .join(", ");
    const sql = this.grammar.compileUpdate(
      this.grammar.wrap(this.tableName),
      sets.split(", "),
      this.compileWheres(),
      this.updateJoins
    );
    return await this.connection.run(sql);
  }

  async delete(): Promise<any> {
    const sql = this.grammar.compileDelete(
      this.grammar.wrap(this.tableName),
      this.compileWheres(),
      this.updateJoins,
      this.limitValue
    );
    return await this.connection.run(sql);
  }

  async increment(column: string, amount: number = 1, extra: Record<string, any> = {}): Promise<any> {
    const sets = [`${this.grammar.wrap(column)} = ${this.grammar.wrap(column)} + ${amount}`];
    for (const [key, value] of Object.entries(extra)) {
      sets.push(`${this.grammar.wrap(key)} = ${this.grammar.escape(value)}`);
    }
    const sql = `UPDATE ${this.grammar.wrap(this.tableName)} SET ${sets.join(", ")} ${this.compileWheres()}`;
    return await this.connection.run(sql.trim());
  }

  async decrement(column: string, amount: number = 1, extra: Record<string, any> = {}): Promise<any> {
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
    const result = await this.select("1 as exists_check").limit(1).get();
    return result.length > 0;
  }

  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  async sole(): Promise<T> {
    const results = await this.limit(2).get();
    if (results.length === 0) {
      throw new ModelNotFoundError(this.model?.name || "Model");
    }
    if (results.length > 1) {
      throw new Error("Multiple records found when only one was expected.");
    }
    return results[0];
  }

  async value(column: string): Promise<any> {
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
    const sql = this.grammar.compileExplain(this.toSql());
    const results = await this.connection.query(sql);
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
      this.lockMode = "FOR UPDATE";
    }
    return this;
  }

  sharedLock(): this {
    const driver = this.connection.getDriverName();
    if (driver === "mysql") {
      this.lockMode = "LOCK IN SHARE MODE";
    } else if (driver === "postgres") {
      this.lockMode = "FOR SHARE";
    }
    return this;
  }

  skipLocked(): this {
    if (this.lockMode) {
      this.lockMode += " SKIP LOCKED";
    }
    return this;
  }

  noWait(): this {
    if (this.lockMode) {
      this.lockMode += " NOWAIT";
    }
    return this;
  }

  private addDateWhere(type: string, column: string, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    const sql = this.grammar.compileDateWhere(type, this.grammar.wrap(column), operator, value);
    this.wheres.push({ type: "raw", column: sql, boolean, scope: undefined });
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

  private withAggregate(relationName: string, column: string, fn: string, alias?: string): this {
    const relation = this.getModelRelation(relationName);
    const defaultAlias = `${relationName}_${fn.toLowerCase()}_${column.replace(/\W+/g, "_")}`;
    this.addSelect(`(${relation.getRelationAggregateSql(this, `${fn}(${relation.qualifyRelatedColumn(column)})`)}) as ${alias || defaultAlias}`);
    return this;
  }
}
