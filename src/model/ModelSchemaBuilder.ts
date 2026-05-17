import { Blueprint } from "../schema/Blueprint.js";
import { Schema, SchemaColumn, SchemaIndex, SchemaForeignKey } from "../schema/Schema.js";
import { Connection } from "../connection/Connection.js";
import type { ColumnType } from "../types/index.js";

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export interface ModelInfo {
  casts: Record<string, any>;
  fillable: string[];
  attributes: Record<string, any>;
  primaryKey: string;
  keyType: "int" | "string" | "uuid";
  incrementing: boolean;
  timestamps: boolean;
  softDeletes: boolean;
  deletedAtColumn: string;
  schemaDefinition?: (blueprint: Blueprint) => void;
}

function castToColumnType(cast: any): string {
  const s = typeof cast === "string" ? cast.toLowerCase() : "";
  if (s === "integer" || s === "int") return "integer";
  if (s === "biginteger" || s === "bigint") return "bigInteger";
  if (s === "boolean" || s === "bool") return "boolean";
  if (s === "float") return "float";
  if (s === "double") return "double";
  if (s === "decimal") return "decimal";
  if (s === "date") return "date";
  if (s === "datetime" || s === "timestamp") return "dateTime";
  if (s === "json" || s === "array" || s === "collection") return "json";
  if (s === "uuid") return "uuid";
  return "string";
}

function buildBlueprintFromModel(blueprint: Blueprint, info: ModelInfo): void {
  const { primaryKey, keyType, incrementing, timestamps, softDeletes, deletedAtColumn, casts, fillable, attributes } = info;

  // Primary key
  if (keyType === "uuid") {
    blueprint.uuid(primaryKey).primary();
  } else if (incrementing) {
    blueprint.increments(primaryKey);
  } else {
    blueprint.integer(primaryKey).primary();
  }

  // Known fields (fillable + casts keys, minus pk and timestamp columns)
  const reserved = new Set([primaryKey, "created_at", "updated_at", deletedAtColumn]);
  const fields = [...new Set([...fillable, ...Object.keys(casts), ...Object.keys(attributes)])].filter(
    (f) => !reserved.has(f)
  );

  for (const field of fields) {
    const cast = casts[field];
    const colType = castToColumnType(cast);
    const def = attributes[field];

    let col: ReturnType<Blueprint["string"]>;
    switch (colType) {
      case "integer":     col = blueprint.integer(field); break;
      case "bigInteger":  col = blueprint.bigInteger(field); break;
      case "boolean":     col = blueprint.boolean(field); break;
      case "float":       col = blueprint.float(field); break;
      case "double":      col = blueprint.double(field); break;
      case "decimal":     col = blueprint.decimal(field); break;
      case "date":        col = blueprint.date(field); break;
      case "dateTime":    col = blueprint.dateTime(field); break;
      case "json":        col = blueprint.json(field); break;
      case "uuid":        col = blueprint.uuid(field); break;
      default:            col = blueprint.string(field); break;
    }

    if (def !== undefined) col.default(def);
  }

  if (timestamps) blueprint.timestamps();
  if (softDeletes) blueprint.softDeletes();
}

function dbTypeToColumnType(dbType: string): ColumnType {
  const t = dbType.toLowerCase();
  if (t.startsWith("varchar") || t.startsWith("character varying")) return "string";
  if (t === "text" || t.startsWith("text")) return "text";
  if (t === "uuid") return "uuid";
  if (t === "boolean" || t === "bool" || t === "tinyint(1)") return "boolean";
  if (t === "bigint" || t === "int8" || t === "bigint unsigned") return "bigInteger";
  if (t === "smallint" || t === "int2") return "smallInteger";
  if (t === "tinyint") return "tinyInteger";
  if (t.startsWith("int") || t === "integer" || t === "int4") return "integer";
  if (t === "float" || t === "real" || t === "float4") return "float";
  if (t === "double precision" || t === "float8" || t === "double") return "double";
  if (t.startsWith("numeric") || t.startsWith("decimal")) return "decimal";
  if (t === "date") return "date";
  if (t.startsWith("timestamp") || t === "datetime") return "dateTime";
  if (t.startsWith("time")) return "time";
  if (t === "json") return "json";
  if (t === "jsonb") return "jsonb";
  if (t === "blob" || t === "bytea" || t === "binary") return "binary";
  return "string";
}

function blueprintFromColumns(tableName: string, columns: SchemaColumn[]): Blueprint {
  const bp = new Blueprint(tableName);
  for (const col of columns) {
    bp.columns.push({
      name: col.name,
      type: dbTypeToColumnType(col.type),
      nullable: col.nullable,
      autoIncrement: col.autoIncrement,
      primary: col.primary,
      unique: false,
      index: false,
      unsigned: col.autoIncrement,
      default: col.default,
    });
  }
  return bp;
}

function pad(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - str.length));
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const top = "┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  const mid = "├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
  const bot = "└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";
  const row = (cells: string[]) =>
    "│" + cells.map((c, i) => " " + pad(c, widths[i]) + " ").join("│") + "│";
  return [top, row(headers), mid, ...rows.map(row), bot].join("\n");
}

class TableDisplay {
  constructor(private content: string) {}
  toString() { return this.content; }
  [INSPECT]() { return this.content; }
}

export class SchemaResult {
  constructor(
    public readonly columns: SchemaColumn[],
    public readonly indexes: SchemaIndex[],
    public readonly foreignKeys: SchemaForeignKey[],
    public readonly tableName: string
  ) {}

  get blueprint(): Blueprint {
    return blueprintFromColumns(this.tableName, this.columns);
  }

  private renderAll(): string {
    const parts: string[] = [`\n  ${this.tableName}\n`];

    const colHeaders = ["column", "type", "nullable", "default", "pk", "ai"];
    const colRows = this.columns.map((c) => [
      c.name,
      c.type,
      c.nullable ? "yes" : "no",
      c.default != null ? String(c.default) : "—",
      c.primary ? "✓" : "",
      c.autoIncrement ? "✓" : "",
    ]);
    parts.push(renderTable(colHeaders, colRows));

    if (this.indexes.length > 0) {
      const idxHeaders = ["index", "columns", "unique", "primary"];
      const idxRows = this.indexes.map((i) => [
        i.name,
        i.columns.join(", "),
        i.unique ? "✓" : "",
        i.primary ? "✓" : "",
      ]);
      parts.push("\n  indexes\n" + renderTable(idxHeaders, idxRows));
    }

    if (this.foreignKeys.length > 0) {
      const fkHeaders = ["columns", "references", "on table", "on delete", "on update"];
      const fkRows = this.foreignKeys.map((fk) => [
        fk.columns.join(", "),
        fk.references.join(", "),
        fk.onTable,
        fk.onDelete ?? "—",
        fk.onUpdate ?? "—",
      ]);
      parts.push("\n  foreign keys\n" + renderTable(fkHeaders, fkRows));
    }

    return parts.join("\n");
  }

  get table(): TableDisplay {
    return new TableDisplay(this.renderAll());
  }

  [INSPECT]() {
    return this.renderAll();
  }

  toJSON() {
    return {
      columns: this.columns,
      indexes: this.indexes,
      foreignKeys: this.foreignKeys,
    };
  }
}

export type IntrospectedSchema = SchemaResult;

class BlueprintPromise implements PromiseLike<Blueprint> {
  constructor(private promise: Promise<Blueprint>) {}

  then<T, E>(
    onfulfilled?: ((value: Blueprint) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: any) => E | PromiseLike<E>) | null
  ): Promise<T | E> {
    return this.promise.then(onfulfilled, onrejected) as Promise<T | E>;
  }

  get columns(): Promise<Blueprint["columns"]> {
    return this.promise.then((bp) => bp.columns);
  }
}

class IntrospectPromise implements PromiseLike<SchemaResult> {
  constructor(private promise: Promise<SchemaResult>) {}

  then<T, E>(
    onfulfilled?: ((value: SchemaResult) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: any) => E | PromiseLike<E>) | null
  ): Promise<T | E> {
    return this.promise.then(onfulfilled, onrejected) as Promise<T | E>;
  }

  get table(): Promise<TableDisplay> {
    return this.promise.then((r) => r.table);
  }

  get blueprint(): BlueprintPromise {
    return new BlueprintPromise(this.promise.then((r) => r.blueprint));
  }
}

export class ModelSchemaBuilder {
  readonly blueprint: Blueprint;

  constructor(
    private tableName: string,
    private connection: Connection,
    private info: ModelInfo
  ) {
    this.blueprint = new Blueprint(tableName);
    if (info.schemaDefinition) {
      info.schemaDefinition(this.blueprint);
    } else {
      buildBlueprintFromModel(this.blueprint, info);
    }
  }

  introspect(): IntrospectPromise {
    const promise = (async () => {
      const prev = this.connection.logQueries;
      this.connection.logQueries = false;
      try {
        const [columns, indexes, foreignKeys] = await Promise.all([
          Schema.getColumns(this.tableName, this.connection),
          Schema.getIndexes(this.tableName, this.connection),
          Schema.getForeignKeys(this.tableName, this.connection),
        ]);
        return new SchemaResult(columns, indexes, foreignKeys, this.tableName);
      } finally {
        this.connection.logQueries = prev;
      }
    })();
    return new IntrospectPromise(promise);
  }
}
