import { Grammar } from "./Grammar.js";
import type { ColumnDefinition } from "../../types/index.js";

export class SQLiteGrammar extends Grammar {
  protected wrappers = { prefix: '"', suffix: '"' };

  protected getType(column: ColumnDefinition): string {
    switch (column.type) {
      case "string":
        return "TEXT";
      case "text":
        return "TEXT";
      case "integer":
        return "INTEGER";
      case "bigInteger":
        return "INTEGER";
      case "smallInteger":
        return "INTEGER";
      case "tinyInteger":
        return "INTEGER";
      case "float":
      case "double":
      case "decimal":
        return "REAL";
      case "boolean":
        return "INTEGER";
      case "date":
      case "dateTime":
      case "time":
      case "timestamp":
        return "TEXT";
      case "json":
      case "jsonb":
        return "TEXT";
      case "binary":
        return "BLOB";
      case "uuid":
        return "TEXT";
      case "enum":
        return "TEXT";
      default:
        return "TEXT";
    }
  }

  protected modifyAutoIncrement(column: ColumnDefinition): string {
    if (column.autoIncrement) return " PRIMARY KEY AUTOINCREMENT";
    return "";
  }

  protected getColumn(_blueprint: any, column: ColumnDefinition): string {
    let sql = `${this.wrap(column.name)} ${this.getType(column)}`;
    if (column.autoIncrement) sql += this.modifyAutoIncrement(column);
    else if (column.primary) sql += " PRIMARY KEY";
    if (!column.nullable) sql += " NOT NULL";
    if (column.default !== undefined) sql += ` DEFAULT ${this.getDefaultValue(column.default)}`;
    if (column.unique && !column.autoIncrement) sql += " UNIQUE";
    return sql;
  }

  compileColumnRename(table: string, from: string, to: string): string {
    return `ALTER TABLE ${this.wrap(table)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`;
  }

  compileDropColumn(table: string, columns: string[]): string | string[] {
    // SQLite 3.35.0+ supports dropping columns.
    return columns.map((col) => `ALTER TABLE ${this.wrap(table)} DROP COLUMN ${this.wrap(col)}`);
  }

  compileChange(_table: string, _column: ColumnDefinition): string | string[] {
    throw new Error("Changing existing columns is not supported by the SQLite grammar.");
  }

  compileForeignKeys(blueprint: any, table: string): string[] {
    // SQLite supports foreign keys inside CREATE TABLE only.
    // For simplicity, ALTER TABLE ADD CONSTRAINT is not supported in SQLite.
    // We'll add inline foreign keys in CREATE TABLE by overriding compileCreate.
    return [];
  }

  compileCreate(blueprint: any, table: string): string {
    const columns = this.getColumns(blueprint).map((col) => `    ${col}`).join(",\n");
    const fks = blueprint.foreignKeys
      .map((fk: any) => {
        let sql = `    FOREIGN KEY (${this.wrapArray(fk.columns).join(", ")}) REFERENCES ${this.wrap(fk.onTable)} (${this.wrapArray(fk.references).join(", ")})`;
        if (fk.onDelete) sql += ` ON DELETE ${fk.onDelete}`;
        if (fk.onUpdate) sql += ` ON UPDATE ${fk.onUpdate}`;
        return sql;
      })
      .join(",\n");
    let sql = `CREATE TABLE ${this.wrap(table)} (\n${columns}`;
    if (fks) sql += `,\n${fks}`;
    sql += "\n)";
    return sql;
  }

  compileCreateIfNotExists(blueprint: any, table: string): string {
    const columns = this.getColumns(blueprint).map((col) => `    ${col}`).join(",\n");
    const fks = blueprint.foreignKeys
      .map((fk: any) => {
        let sql = `    FOREIGN KEY (${this.wrapArray(fk.columns).join(", ")}) REFERENCES ${this.wrap(fk.onTable)} (${this.wrapArray(fk.references).join(", ")})`;
        if (fk.onDelete) sql += ` ON DELETE ${fk.onDelete}`;
        if (fk.onUpdate) sql += ` ON UPDATE ${fk.onUpdate}`;
        return sql;
      })
      .join(",\n");
    let sql = `CREATE TABLE IF NOT EXISTS ${this.wrap(table)} (\n${columns}`;
    if (fks) sql += `,\n${fks}`;
    sql += "\n)";
    return sql;
  }
}
