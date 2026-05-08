import { Blueprint } from "../Blueprint.js";
import type { ColumnDefinition, IndexDefinition, ForeignKeyDefinition } from "../../types/index.js";

export abstract class Grammar {
  protected wrappers: Record<string, string> = { prefix: '"', suffix: '"' };

  wrap(value: string): string {
    if (value.includes(".")) {
      return value.split(".").map((v) => this.wrap(v)).join(".");
    }
    const { prefix, suffix } = this.wrappers;
    return `${prefix}${value}${suffix}`;
  }

  wrapArray(values: string[]): string[] {
    return values.map((v) => this.wrap(v));
  }

  compileCreate(blueprint: Blueprint, table: string): string {
    const columns = this.getColumns(blueprint).map((col) => `    ${col}`).join(",\n");
    const sql = `CREATE TABLE ${this.wrap(table)} (\n${columns}\n)`;
    return sql;
  }

  compileCreateIfNotExists(blueprint: Blueprint, table: string): string {
    const columns = this.getColumns(blueprint).map((col) => `    ${col}`).join(",\n");
    return `CREATE TABLE IF NOT EXISTS ${this.wrap(table)} (\n${columns}\n)`;
  }

  compileDrop(table: string): string {
    return `DROP TABLE ${this.wrap(table)}`;
  }

  compileDropIfExists(table: string): string {
    return `DROP TABLE IF EXISTS ${this.wrap(table)}`;
  }

  compileRename(from: string, to: string): string {
    return `ALTER TABLE ${this.wrap(from)} RENAME TO ${this.wrap(to)}`;
  }

  compileAdd(blueprint: Blueprint, table: string): string[] {
    const columns = this.getColumns(blueprint);
    return columns.map((col) => `ALTER TABLE ${this.wrap(table)} ADD COLUMN ${col}`);
  }

  protected getColumns(blueprint: Blueprint): string[] {
    return blueprint.columns.map((col) => this.getColumn(blueprint, col));
  }

  protected getColumn(_blueprint: Blueprint, column: ColumnDefinition): string {
    let sql = `${this.wrap(column.name)} ${this.getType(column)}`;
    if (column.unsigned) sql += this.modifyUnsigned(column);
    if (!column.nullable) sql += " NOT NULL";
    if (column.default !== undefined) sql += ` DEFAULT ${this.getDefaultValue(column.default)}`;
    if (column.autoIncrement) sql += this.modifyAutoIncrement(column);
    if (column.comment) sql += this.modifyComment(column);
    return sql;
  }

  protected abstract getType(column: ColumnDefinition): string;

  protected modifyUnsigned(_column: ColumnDefinition): string {
    return "";
  }

  protected modifyAutoIncrement(_column: ColumnDefinition): string {
    return "";
  }

  protected modifyComment(_column: ColumnDefinition): string {
    return "";
  }

  protected getDefaultValue(value: any): string {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number") return String(value);
    if (typeof value === "string" && value.toUpperCase().includes("CURRENT_TIMESTAMP")) return value;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  compileIndexes(blueprint: Blueprint, table: string): string[] {
    const statements: string[] = [];
    for (const index of blueprint.indexes) {
      statements.push(this.compileIndex(table, index));
    }
    return statements;
  }

  protected compileIndex(table: string, index: IndexDefinition): string {
    const type = index.unique ? "UNIQUE INDEX" : "INDEX";
    return `CREATE ${type} ${this.wrap(index.name)} ON ${this.wrap(table)} (${this.wrapArray(index.columns).join(", ")})`;
  }

  compileForeignKeys(blueprint: Blueprint, table: string): string[] {
    return blueprint.foreignKeys.map((fk) => this.compileForeignKey(table, fk));
  }

  protected compileForeignKey(table: string, fk: ForeignKeyDefinition): string {
    const sql = `ALTER TABLE ${this.wrap(table)} ADD CONSTRAINT ${this.wrap(fk.name || "")} FOREIGN KEY (${this.wrapArray(fk.columns).join(", ")}) REFERENCES ${this.wrap(fk.onTable)} (${this.wrapArray(fk.references).join(", ")})`;
    let full = sql;
    if (fk.onDelete) full += ` ON DELETE ${fk.onDelete}`;
    if (fk.onUpdate) full += ` ON UPDATE ${fk.onUpdate}`;
    return full;
  }

  abstract compileColumnRename(table: string, from: string, to: string): string;
  abstract compileDropColumn(table: string, columns: string[]): string | string[];
}
