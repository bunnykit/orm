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

  placeholder(index: number): string {
    return `$${index}`;
  }

  compileRandomOrder(): string {
    return "ORDER BY RANDOM()";
  }

  compileDateWhere(type: string, column: string, operator: string, value: any, binding?: (value: any) => string): string {
    const val = binding ? binding(value) : this.escape(value);
    switch (type) {
      case "date":
        return `(${column})::date ${operator} ${val}`;
      case "day":
        return `EXTRACT(DAY FROM ${column}) ${operator} ${val}`;
      case "month":
        return `EXTRACT(MONTH FROM ${column}) ${operator} ${val}`;
      case "year":
        return `EXTRACT(YEAR FROM ${column}) ${operator} ${val}`;
      case "time":
        return `(${column})::time ${operator} ${val}`;
      default:
        return `${column} ${operator} ${val}`;
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

  compileJsonContains(column: string, value: any, binding?: (value: any) => string): string {
    return `${column} @> ${binding ? binding(JSON.stringify([value])) : this.escape(JSON.stringify([value]))}`;
  }

  compileJsonLength(column: string, operator: string, value: any, binding?: (value: any) => string): string {
    return `jsonb_array_length(${column}) ${operator} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileRegexp(column: string, value: string, not: boolean, binding?: (value: any) => string): string {
    const op = not ? "!~" : "~";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string, binding?: (value: any) => string): string {
    const cols = columns.length > 1
      ? `concat_ws(' ', ${columns.join(", ")})`
      : columns[0];
    return `to_tsvector('english', ${cols}) @@ plainto_tsquery('english', ${binding ? binding(value) : this.escape(value)})`;
  }

  compileExplain(sql: string): string {
    return `EXPLAIN (FORMAT JSON) ${sql}`;
  }
}
