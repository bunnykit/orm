export type ColumnType =
  | "string"
  | "text"
  | "integer"
  | "bigInteger"
  | "smallInteger"
  | "tinyInteger"
  | "float"
  | "double"
  | "decimal"
  | "boolean"
  | "date"
  | "dateTime"
  | "time"
  | "timestamp"
  | "json"
  | "jsonb"
  | "binary"
  | "uuid"
  | "enum";

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  default?: any;
  autoIncrement: boolean;
  primary: boolean;
  unique: boolean;
  index: boolean;
  unsigned: boolean;
  values?: string[]; // for enum
  comment?: string;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyDefinition {
  name?: string;
  columns: string[];
  references: string[];
  onTable: string;
  onDelete?: string;
  onUpdate?: string;
}

export interface WhereClause {
  type: "basic" | "in" | "null" | "raw" | "between" | "column" | "exists";
  column: string;
  operator?: string;
  value?: any;
  boolean: "and" | "or";
  scope?: string;
}

export interface OrderClause {
  column: string;
  direction: "asc" | "desc";
}

export type ConnectionConfig =
  | { url: string }
  | {
      driver: "sqlite" | "mysql" | "postgres";
      host?: string;
      port?: number;
      database?: string;
      username?: string;
      password?: string;
      filename?: string; // sqlite
    };
