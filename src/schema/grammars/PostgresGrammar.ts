import { Grammar } from "./Grammar.js";
import type { ColumnDefinition } from "../../types/index.js";

export class PostgresGrammar extends Grammar {
  protected wrappers = { prefix: '"', suffix: '"' };

  protected getDefaultValue(value: any): string {
    if (typeof value === "boolean") {
      return value ? "TRUE" : "FALSE";
    }
    return super.getDefaultValue(value);
  }

  protected getType(column: ColumnDefinition): string {
    switch (column.type) {
      case "string":
        return `VARCHAR(${column.length || 255})`;
      case "text":
        return "TEXT";
      case "integer":
        return "INTEGER";
      case "bigInteger":
        return "BIGINT";
      case "smallInteger":
        return "SMALLINT";
      case "tinyInteger":
        return "SMALLINT";
      case "float":
        return `REAL`;
      case "double":
        return `DOUBLE PRECISION`;
      case "decimal":
        return `DECIMAL(${column.precision || 8}, ${column.scale || 2})`;
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "dateTime":
        return "TIMESTAMP(0) WITHOUT TIME ZONE";
      case "time":
        return "TIME(0) WITHOUT TIME ZONE";
      case "timestamp":
        return "TIMESTAMP(0) WITHOUT TIME ZONE";
      case "json":
        return "JSON";
      case "jsonb":
        return "JSONB";
      case "binary":
        return "BYTEA";
      case "uuid":
        return "UUID";
      case "enum":
        return `VARCHAR(255)`;
      default:
        return "TEXT";
    }
  }

  protected modifyAutoIncrement(column: ColumnDefinition): string {
    if (column.autoIncrement) {
      return column.type === "bigInteger" ? " GENERATED ALWAYS AS IDENTITY" : " GENERATED ALWAYS AS IDENTITY";
    }
    return "";
  }

  protected getColumn(_blueprint: any, column: ColumnDefinition): string {
    let sql = `${this.wrap(column.name)} ${this.getType(column)}`;
    if (!column.nullable) sql += " NOT NULL";
    if (column.default !== undefined) sql += ` DEFAULT ${this.getDefaultValue(column.default)}`;
    if (column.autoIncrement) sql += this.modifyAutoIncrement(column);
    if (column.unique) sql += " UNIQUE";
    if (column.primary) sql += " PRIMARY KEY";
    return sql;
  }

  compileColumnRename(table: string, from: string, to: string): string {
    return `ALTER TABLE ${this.wrap(table)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`;
  }

  compileDropColumn(table: string, columns: string[]): string {
    return `ALTER TABLE ${this.wrap(table)} ${columns.map((col) => `DROP COLUMN ${this.wrap(col)}`).join(", ")}`;
  }

  compileChange(table: string, column: ColumnDefinition): string[] {
    const statements = [
      `ALTER TABLE ${this.wrap(table)} ALTER COLUMN ${this.wrap(column.name)} TYPE ${this.getType(column)}`,
      `ALTER TABLE ${this.wrap(table)} ALTER COLUMN ${this.wrap(column.name)} ${column.nullable ? "DROP" : "SET"} NOT NULL`,
    ];
    if (column.default !== undefined) {
      statements.push(`ALTER TABLE ${this.wrap(table)} ALTER COLUMN ${this.wrap(column.name)} SET DEFAULT ${this.getDefaultValue(column.default)}`);
    }
    return statements;
  }

  compileIndex(table: string, index: any): string {
    const type = index.unique ? "UNIQUE INDEX" : "INDEX";
    return `CREATE ${type} ${this.wrap(index.name)} ON ${this.wrap(table)} (${this.wrapArray(index.columns).join(", ")})`;
  }

  compileCreate(blueprint: any, table: string): string {
    const columns = this.getColumns(blueprint).map((col) => `    ${col}`).join(",\n");
    const sql = `CREATE TABLE ${this.wrap(table)} (\n${columns}\n)`;
    return sql;
  }

  compileCreateIfNotExists(blueprint: any, table: string): string {
    const columns = this.getColumns(blueprint).map((col) => `    ${col}`).join(",\n");
    const sql = `CREATE TABLE IF NOT EXISTS ${this.wrap(table)} (\n${columns}\n)`;
    return sql;
  }
}
