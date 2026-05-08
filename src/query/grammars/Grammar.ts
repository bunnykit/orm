export abstract class Grammar {
  abstract wrap(value: string): string;

  wrapArray(values: string[]): string[] {
    return values.map((v) => this.wrap(v));
  }

  escape(value: any): string {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number") return String(value);
    if (typeof value === "string" && value.toUpperCase().includes("CURRENT_TIMESTAMP")) return value;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  abstract compileRandomOrder(): string;

  compileOffset(offset: number, _limit?: number): string {
    return `OFFSET ${offset}`;
  }

  compileLock(lockMode?: string): string {
    return lockMode ? ` ${lockMode}` : "";
  }

  abstract compileDateWhere(type: string, column: string, operator: string, value: any): string;

  abstract compileInsertOrIgnore(table: string, columns: string[], values: string[]): string;

  abstract compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    uniqueBy: string[],
    updateColumns: string[]
  ): string;

  compileUpdate(table: string, sets: string[], wheres: string, joins?: string[]): string {
    let sql = `UPDATE ${table}`;
    if (joins && joins.length > 0) {
      sql += ` ${joins.join(" ")}`;
    }
    sql += ` SET ${sets.join(", ")}`;
    if (wheres) sql += ` ${wheres}`;
    return sql.trim();
  }

  compileDelete(table: string, wheres: string, joins?: string[], limit?: number): string {
    let sql = `DELETE FROM ${table}`;
    if (joins && joins.length > 0) {
      sql += ` ${joins.join(" ")}`;
    }
    if (wheres) sql += ` ${wheres}`;
    if (limit !== undefined) sql += ` LIMIT ${limit}`;
    return sql.trim();
  }

  abstract compileJsonContains(column: string, value: any): string;

  abstract compileJsonLength(column: string, operator: string, value: any): string;

  compileLike(column: string, value: string, not: boolean): string {
    const op = not ? "NOT LIKE" : "LIKE";
    return `${column} ${op} ${this.escape(value)}`;
  }

  abstract compileRegexp(column: string, value: string, not: boolean): string;

  abstract compileFullText(columns: string[], value: string): string;

  abstract compileExplain(sql: string): string;
}
