import { Grammar } from "./Grammar.js";
import type { ColumnDefinition } from "../../types/index.js";

export class MySqlGrammar extends Grammar {
  protected wrappers = { prefix: "`", suffix: "`" };

  protected getType(column: ColumnDefinition): string {
    switch (column.type) {
      case "string":
        return `VARCHAR(${column.length || 255})`;
      case "text":
        return "TEXT";
      case "integer":
        return "INT";
      case "bigInteger":
        return "BIGINT";
      case "smallInteger":
        return "SMALLINT";
      case "tinyInteger":
        return "TINYINT";
      case "float":
        return `FLOAT(${column.precision || 8}, ${column.scale || 2})`;
      case "double":
        return `DOUBLE(${column.precision || 8}, ${column.scale || 2})`;
      case "decimal":
        return `DECIMAL(${column.precision || 8}, ${column.scale || 2})`;
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "dateTime":
        return "DATETIME";
      case "time":
        return "TIME";
      case "timestamp":
        return "TIMESTAMP";
      case "json":
        return "JSON";
      case "jsonb":
        return "JSON";
      case "binary":
        return "BLOB";
      case "uuid":
        return "CHAR(36)";
      case "enum":
        return `ENUM('${(column.values || []).join("','")}')`;
      default:
        return "TEXT";
    }
  }

  protected modifyUnsigned(column: ColumnDefinition): string {
    return column.unsigned ? " UNSIGNED" : "";
  }

  protected modifyAutoIncrement(column: ColumnDefinition): string {
    return column.autoIncrement ? " AUTO_INCREMENT" : "";
  }

  protected modifyComment(column: ColumnDefinition): string {
    return column.comment ? ` COMMENT '${column.comment.replace(/'/g, "\\'")}'` : "";
  }

  protected getColumn(_blueprint: any, column: ColumnDefinition): string {
    let sql = `${this.wrap(column.name)} ${this.getType(column)}`;
    if (column.unsigned) sql += this.modifyUnsigned(column);
    if (!column.nullable) sql += " NOT NULL";
    if (column.default !== undefined) sql += ` DEFAULT ${this.getDefaultValue(column.default)}`;
    if (column.autoIncrement) sql += this.modifyAutoIncrement(column);
    if (column.unique) sql += " UNIQUE";
    if (column.primary) sql += " PRIMARY KEY";
    if (column.comment) sql += this.modifyComment(column);
    return sql;
  }

  compileColumnRename(table: string, from: string, to: string): string {
    // MySQL requires full column definition for rename; simplified here.
    return `ALTER TABLE ${this.wrap(table)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`;
  }

  compileDropColumn(table: string, columns: string[]): string {
    return `ALTER TABLE ${this.wrap(table)} ${columns.map((col) => `DROP COLUMN ${this.wrap(col)}`).join(", ")}`;
  }

  compileIndex(table: string, index: any): string {
    const type = index.unique ? "UNIQUE INDEX" : "INDEX";
    return `ALTER TABLE ${this.wrap(table)} ADD ${type} ${this.wrap(index.name)} (${this.wrapArray(index.columns).join(", ")})`;
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
