import type { ColumnDefinition, IndexDefinition, ColumnType } from "../types/index.js";

export class ForeignKeyBuilder {
  fk: { name?: string; columns: string[]; references: string[]; onTable: string; onDelete?: string; onUpdate?: string };
  blueprint: Blueprint;

  constructor(blueprint: Blueprint, columns: string[], name?: string) {
    this.blueprint = blueprint;
    this.fk = { name, columns, references: [], onTable: "" };
    blueprint.foreignKeys.push(this.fk);
  }

  references(columns: string | string[]): this {
    this.fk.references = Array.isArray(columns) ? columns : [columns];
    return this;
  }

  on(table: string): this {
    this.fk.onTable = table;
    return this;
  }

  onDelete(action: string): this {
    this.fk.onDelete = action;
    return this;
  }

  onUpdate(action: string): this {
    this.fk.onUpdate = action;
    return this;
  }
}

export class Blueprint {
  readonly table: string;
  columns: ColumnDefinition[] = [];
  indexes: IndexDefinition[] = [];
  foreignKeys: any[] = [];
  commands: { name: string; parameters?: Record<string, any> }[] = [];

  private currentColumn?: ColumnDefinition;

  constructor(table: string) {
    this.table = table;
  }

  private addColumn(type: ColumnType, name: string, length?: number): this {
    const column: ColumnDefinition = {
      name,
      type,
      length,
      nullable: false,
      autoIncrement: false,
      primary: false,
      unique: false,
      index: false,
      unsigned: false,
    };
    this.columns.push(column);
    this.currentColumn = column;
    return this;
  }

  increments(name: string = "id"): this {
    const col = this.addColumn("integer", name);
    col.currentColumn!.autoIncrement = true;
    col.currentColumn!.primary = true;
    col.currentColumn!.unsigned = true;
    return this;
  }

  bigIncrements(name: string = "id"): this {
    const col = this.addColumn("bigInteger", name);
    col.currentColumn!.autoIncrement = true;
    col.currentColumn!.primary = true;
    col.currentColumn!.unsigned = true;
    return this;
  }

  string(name: string, length: number = 255): this {
    return this.addColumn("string", name, length);
  }

  text(name: string): this {
    return this.addColumn("text", name);
  }

  integer(name: string): this {
    return this.addColumn("integer", name);
  }

  bigInteger(name: string): this {
    return this.addColumn("bigInteger", name);
  }

  smallInteger(name: string): this {
    return this.addColumn("smallInteger", name);
  }

  tinyInteger(name: string): this {
    return this.addColumn("tinyInteger", name);
  }

  float(name: string, precision: number = 8, scale: number = 2): this {
    this.addColumn("float", name);
    this.currentColumn!.precision = precision;
    this.currentColumn!.scale = scale;
    return this;
  }

  double(name: string, precision: number = 8, scale: number = 2): this {
    this.addColumn("double", name);
    this.currentColumn!.precision = precision;
    this.currentColumn!.scale = scale;
    return this;
  }

  decimal(name: string, precision: number = 8, scale: number = 2): this {
    this.addColumn("decimal", name);
    this.currentColumn!.precision = precision;
    this.currentColumn!.scale = scale;
    return this;
  }

  boolean(name: string): this {
    return this.addColumn("boolean", name);
  }

  date(name: string): this {
    return this.addColumn("date", name);
  }

  dateTime(name: string): this {
    return this.addColumn("dateTime", name);
  }

  time(name: string): this {
    return this.addColumn("time", name);
  }

  timestamp(name: string): this {
    return this.addColumn("timestamp", name);
  }

  json(name: string): this {
    return this.addColumn("json", name);
  }

  jsonb(name: string): this {
    return this.addColumn("jsonb", name);
  }

  binary(name: string): this {
    return this.addColumn("binary", name);
  }

  uuid(name: string): this {
    return this.addColumn("uuid", name);
  }

  enum(name: string, values: string[]): this {
    this.addColumn("enum", name);
    this.currentColumn!.values = values;
    return this;
  }

  nullable(): this {
    if (this.currentColumn) this.currentColumn.nullable = true;
    return this;
  }

  default(value: any): this {
    if (this.currentColumn) this.currentColumn.default = value;
    return this;
  }

  unique(): this {
    if (this.currentColumn) {
      this.currentColumn.unique = true;
    }
    return this;
  }

  index(): this {
    if (this.currentColumn) {
      this.currentColumn.index = true;
    }
    return this;
  }

  primary(): this {
    if (this.currentColumn) {
      this.currentColumn.primary = true;
    }
    return this;
  }

  unsigned(): this {
    if (this.currentColumn) {
      this.currentColumn.unsigned = true;
    }
    return this;
  }

  comment(text: string): this {
    if (this.currentColumn) {
      this.currentColumn.comment = text;
    }
    return this;
  }

  timestamps(): void {
    this.timestamp("created_at").nullable();
    this.timestamp("updated_at").nullable();
  }

  softDeletes(): void {
    this.timestamp("deleted_at").nullable();
  }

  foreign(columns: string | string[], name?: string): ForeignKeyBuilder {
    const cols = Array.isArray(columns) ? columns : [columns];
    return new ForeignKeyBuilder(this, cols, name);
  }

  dropColumn(column: string | string[]): void {
    this.commands.push({ name: "dropColumn", parameters: { column: Array.isArray(column) ? column : [column] } });
  }

  renameColumn(from: string, to: string): void {
    this.commands.push({ name: "renameColumn", parameters: { from, to } });
  }

  dropIndex(name: string): void {
    this.commands.push({ name: "dropIndex", parameters: { name } });
  }

  dropUnique(name: string): void {
    this.commands.push({ name: "dropUnique", parameters: { name } });
  }

  dropForeign(name: string): void {
    this.commands.push({ name: "dropForeign", parameters: { name } });
  }
}
