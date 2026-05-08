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
    return `\`${value}\``;
  }

  compileRandomOrder(): string {
    return "ORDER BY RAND()";
  }

  compileDateWhere(type: string, column: string, operator: string, value: any): string {
    switch (type) {
      case "date":
        return `DATE(${column}) ${operator} ${this.escape(value)}`;
      case "day":
        return `DAY(${column}) ${operator} ${this.escape(value)}`;
      case "month":
        return `MONTH(${column}) ${operator} ${this.escape(value)}`;
      case "year":
        return `YEAR(${column}) ${operator} ${this.escape(value)}`;
      case "time":
        return `TIME(${column}) ${operator} ${this.escape(value)}`;
      default:
        return `${column} ${operator} ${this.escape(value)}`;
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

  compileJsonContains(column: string, value: any): string {
    return `JSON_CONTAINS(${column}, ${this.escape(JSON.stringify(value))})`;
  }

  compileJsonLength(column: string, operator: string, value: any): string {
    return `JSON_LENGTH(${column}) ${operator} ${this.escape(value)}`;
  }

  compileRegexp(column: string, value: string, not: boolean): string {
    const op = not ? "NOT REGEXP" : "REGEXP";
    return `${column} ${op} ${this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string): string {
    return `MATCH (${columns.join(", ")}) AGAINST (${this.escape(value)})`;
  }

  compileExplain(sql: string): string {
    return `EXPLAIN ${sql}`;
  }
}
