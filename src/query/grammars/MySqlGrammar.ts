import { Grammar } from "./Grammar.js";

export class MySqlGrammar extends Grammar {
  wrap(value: string): string {
    if (value.includes(" as ")) {
      const [column, alias] = value.split(/\s+as\s+/i);
      return `${this.wrap(column)} AS ${this.wrap(alias)}`;
    }
    if (value.includes(".")) {
      return value.split(".").map((v) => this.wrap(v)).join(".");
    }
    if (value === "*") return value;
    return `\`${value.replaceAll("`", "``")}\``;
  }

  placeholder(_index: number): string {
    return "?";
  }

  compileRandomOrder(): string {
    return "ORDER BY RAND()";
  }

  compileDateWhere(type: string, column: string, operator: string, value: any, binding?: (value: any) => string): string {
    const val = binding ? binding(value) : this.escape(value);
    switch (type) {
      case "date":
        return `DATE(${column}) ${operator} ${val}`;
      case "day":
        return `DAY(${column}) ${operator} ${val}`;
      case "month":
        return `MONTH(${column}) ${operator} ${val}`;
      case "year":
        return `YEAR(${column}) ${operator} ${val}`;
      case "time":
        return `TIME(${column}) ${operator} ${val}`;
      default:
        return `${column} ${operator} ${val}`;
    }
  }

  compileInsertOrIgnore(table: string, columns: string[], values: string[]): string {
    return `INSERT IGNORE INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;
  }

  compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    _uniqueBy: string[],
    updateColumns: string[]
  ): string {
    const updateCols = updateColumns
      .map((c) => `${this.wrap(c)} = VALUES(${this.wrap(c)})`)
      .join(", ");
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON DUPLICATE KEY UPDATE ${updateCols}`;
  }

  compileJsonContains(column: string, value: any, binding?: (value: any) => string): string {
    return `JSON_CONTAINS(${column}, ${binding ? binding(JSON.stringify(value)) : this.escape(JSON.stringify(value))})`;
  }

  compileJsonLength(column: string, operator: string, value: any, binding?: (value: any) => string): string {
    return `JSON_LENGTH(${column}) ${operator} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileRegexp(column: string, value: string, not: boolean, binding?: (value: any) => string): string {
    const op = not ? "NOT REGEXP" : "REGEXP";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string, binding?: (value: any) => string): string {
    return `MATCH (${columns.join(", ")}) AGAINST (${binding ? binding(value) : this.escape(value)})`;
  }

  compileExplain(sql: string): string {
    return `EXPLAIN ${sql}`;
  }
}
