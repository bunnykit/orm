import { Grammar } from "./Grammar.js";

export class PostgresGrammar extends Grammar {
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

  compileRandomOrder(): string {
    return "ORDER BY RANDOM()";
  }

  compileDateWhere(type: string, column: string, operator: string, value: any): string {
    switch (type) {
      case "date":
        return `(${column})::date ${operator} ${this.escape(value)}`;
      case "day":
        return `EXTRACT(DAY FROM ${column}) ${operator} ${this.escape(value)}`;
      case "month":
        return `EXTRACT(MONTH FROM ${column}) ${operator} ${this.escape(value)}`;
      case "year":
        return `EXTRACT(YEAR FROM ${column}) ${operator} ${this.escape(value)}`;
      case "time":
        return `(${column})::time ${operator} ${this.escape(value)}`;
      default:
        return `${column} ${operator} ${this.escape(value)}`;
    }
  }

  compileInsertOrIgnore(table: string, columns: string[], values: string[]): string {
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON CONFLICT DO NOTHING`;
  }

  compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    uniqueBy: string[],
    updateColumns: string[]
  ): string {
    const updateCols = updateColumns
      .map((c) => `${this.wrap(c)} = EXCLUDED.${this.wrap(c)}`)
      .join(", ");
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON CONFLICT (${uniqueBy.map((c) => this.wrap(c)).join(", ")}) DO UPDATE SET ${updateCols}`;
  }

  compileJsonContains(column: string, value: any): string {
    return `${column} @> ${this.escape(JSON.stringify([value]))}`;
  }

  compileJsonLength(column: string, operator: string, value: any): string {
    return `jsonb_array_length(${column}) ${operator} ${this.escape(value)}`;
  }

  compileRegexp(column: string, value: string, not: boolean): string {
    const op = not ? "!~" : "~";
    return `${column} ${op} ${this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string): string {
    const cols = columns.length > 1
      ? `concat_ws(' ', ${columns.join(", ")})`
      : columns[0];
    return `to_tsvector('english', ${cols}) @@ plainto_tsquery('english', ${this.escape(value)})`;
  }

  compileExplain(sql: string): string {
    return `EXPLAIN (FORMAT JSON) ${sql}`;
  }
}
