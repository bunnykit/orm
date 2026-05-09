import { Grammar } from "./Grammar.js";

export class SQLiteGrammar extends Grammar {
  wrap(value: string): string {
    if (value.includes(" as ")) {
      const [column, alias] = value.split(/\s+as\s+/i);
      return `${this.wrap(column)} AS ${this.wrap(alias)}`;
    }
    if (value.includes(".")) {
      return value.split(".").map((v) => this.wrap(v)).join(".");
    }
    if (value === "*") return value;
    return `"${value}"`;
  }

  placeholder(_index: number): string {
    return "?";
  }

  compileRandomOrder(): string {
    return "ORDER BY RANDOM()";
  }

  compileOffset(offset: number, limit?: number): string {
    const limitSql = limit === undefined ? "LIMIT -1 " : "";
    return `${limitSql}OFFSET ${offset}`;
  }

  compileDateWhere(type: string, column: string, operator: string, value: any, binding?: (value: any) => string): string {
    const val = binding ? binding(value) : this.escape(value);
    switch (type) {
      case "date":
        return `date(${column}) ${operator} ${val}`;
      case "day":
        return `CAST(strftime('%d', ${column}) AS INTEGER) ${operator} ${val}`;
      case "month":
        return `CAST(strftime('%m', ${column}) AS INTEGER) ${operator} ${val}`;
      case "year":
        return `CAST(strftime('%Y', ${column}) AS INTEGER) ${operator} ${val}`;
      case "time":
        return `time(${column}) ${operator} ${val}`;
      default:
        return `${column} ${operator} ${val}`;
    }
  }

  compileInsertOrIgnore(table: string, columns: string[], values: string[]): string {
    return `INSERT OR IGNORE INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;
  }

  compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    uniqueBy: string[],
    updateColumns: string[]
  ): string {
    const updateCols = updateColumns
      .map((c) => `${this.wrap(c)} = excluded.${this.wrap(c)}`)
      .join(", ");
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON CONFLICT(${uniqueBy.map((c) => this.wrap(c)).join(", ")}) DO UPDATE SET ${updateCols}`;
  }

  compileJsonContains(column: string, value: any, binding?: (value: any) => string): string {
    return `${column} IN (SELECT value FROM json_each(${column})) AND ${binding ? binding(value) : this.escape(value)} IN (SELECT value FROM json_each(${column}))`;
  }

  compileJsonLength(column: string, operator: string, value: any, binding?: (value: any) => string): string {
    return `(SELECT COUNT(*) FROM json_each(${column})) ${operator} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileRegexp(column: string, value: string, not: boolean, binding?: (value: any) => string): string {
    const op = not ? "NOT REGEXP" : "REGEXP";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string, binding?: (value: any) => string): string {
    return columns.map((c) => `${this.wrap(c)} LIKE ${binding ? binding(`%${value}%`) : this.escape(`%${value}%`)}`).join(" OR ");
  }

  compileExplain(sql: string): string {
    return `EXPLAIN QUERY PLAN ${sql}`;
  }
}
