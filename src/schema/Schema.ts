import { Connection } from "../connection/Connection.js";
import { Blueprint } from "./Blueprint.js";
import { Grammar } from "./grammars/Grammar.js";
import { SQLiteGrammar } from "./grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "./grammars/MySqlGrammar.js";
import { PostgresGrammar } from "./grammars/PostgresGrammar.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";

export class Schema {
  static connection: Connection;

  static setConnection(connection: Connection): void {
    this.connection = connection;
    ConnectionManager.setDefault(connection);
  }

  static getConnection(): Connection {
    const tenantConnection = TenantContext.current()?.connection;
    const connection = tenantConnection || this.connection || ConnectionManager.getDefault();
    if (!connection) {
      throw new Error("No database connection set.");
    }
    return connection;
  }

  private static getGrammar(): Grammar {
    const driver = this.getConnection().getDriverName();
    switch (driver) {
      case "sqlite":
        return new SQLiteGrammar();
      case "mysql":
        return new MySqlGrammar();
      case "postgres":
        return new PostgresGrammar();
    }
  }

  static async create(table: string, callback: (blueprint: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    const sql = grammar.compileCreate(blueprint, connection.qualifyTable(table));
    await this.getConnection().run(sql);

    const indexes = grammar.compileIndexes(blueprint, connection.qualifyTable(table));
    for (const indexSql of indexes) {
      await this.getConnection().run(indexSql);
    }
  }

  static async createIfNotExists(table: string, callback: (blueprint: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    const sql = grammar.compileCreateIfNotExists(blueprint, connection.qualifyTable(table));
    await this.getConnection().run(sql);

    const indexes = grammar.compileIndexes(blueprint, connection.qualifyTable(table));
    for (const indexSql of indexes) {
      await this.getConnection().run(indexSql);
    }
  }

  static async table(table: string, callback: (blueprint: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    const qualifiedTable = connection.qualifyTable(table);

    for (const command of blueprint.commands) {
      if (command.name === "dropColumn") {
        const sql = grammar.compileDropColumn(qualifiedTable, command.parameters!.column);
        if (Array.isArray(sql)) {
          for (const s of sql) await this.getConnection().run(s);
        } else {
          await this.getConnection().run(sql);
        }
      } else if (command.name === "renameColumn") {
        const sql = grammar.compileColumnRename(qualifiedTable, command.parameters!.from, command.parameters!.to);
        await this.getConnection().run(sql);
      } else if (command.name === "dropIndex") {
        await this.getConnection().run(`DROP INDEX ${grammar.wrap(command.parameters!.name)}`);
      } else if (command.name === "dropUnique") {
        await this.getConnection().run(`DROP INDEX ${grammar.wrap(command.parameters!.name)}`);
      } else if (command.name === "dropForeign") {
        await this.getConnection().run(
          `ALTER TABLE ${grammar.wrap(table)} DROP CONSTRAINT ${grammar.wrap(command.parameters!.name)}`
        );
      }
    }

    const addSqls = grammar.compileAdd(blueprint, qualifiedTable);
    for (const sql of addSqls) {
      await this.getConnection().run(sql);
    }

    const indexes = grammar.compileIndexes(blueprint, qualifiedTable);
    for (const indexSql of indexes) {
      await this.getConnection().run(indexSql);
    }

    const fks = grammar.compileForeignKeys(blueprint, qualifiedTable);
    for (const fkSql of fks) {
      await this.getConnection().run(fkSql);
    }
  }

  static async drop(table: string): Promise<void> {
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    await connection.run(grammar.compileDrop(connection.qualifyTable(table)));
  }

  static async dropIfExists(table: string): Promise<void> {
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    await connection.run(grammar.compileDropIfExists(connection.qualifyTable(table)));
  }

  static async rename(from: string, to: string): Promise<void> {
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    await connection.run(grammar.compileRename(connection.qualifyTable(from), connection.qualifyTable(to)));
  }

  static async hasTable(table: string): Promise<boolean> {
    const connection = this.getConnection();
    const driver = connection.getDriverName();
    const schema = connection.getSchema() || "public";
    let sql: string;
    if (driver === "sqlite") {
      sql = `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`;
    } else if (driver === "mysql") {
      sql = `SHOW TABLES LIKE '${table}'`;
    } else {
      sql = `SELECT * FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}'`;
    }
    const result = await connection.query(sql);
    return result.length > 0;
  }

  static async hasColumn(table: string, column: string): Promise<boolean> {
    const connection = this.getConnection();
    const driver = connection.getDriverName();
    const schema = connection.getSchema() || "public";
    let sql: string;
    if (driver === "sqlite") {
      sql = `PRAGMA table_info(${table})`;
      const result = await connection.query(sql);
      return result.some((row: any) => row.name === column);
    } else if (driver === "mysql") {
      sql = `SHOW COLUMNS FROM ${table} LIKE '${column}'`;
    } else {
      sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${table}' AND column_name = '${column}'`;
    }
    const result = await connection.query(sql);
    return result.length > 0;
  }

  static async getColumn(
    table: string,
    column: string
  ): Promise<{ name: string; type: string; primary: boolean; autoIncrement: boolean } | null> {
    const connection = this.getConnection();
    const driver = connection.getDriverName();
    const schema = connection.getSchema() || "public";
    if (driver === "sqlite") {
      const rows = await connection.query(`PRAGMA table_info(${table})`);
      const row = rows.find((item: any) => item.name === column);
      return row ? { name: row.name, type: row.type, primary: row.pk > 0, autoIncrement: false } as any : null;
    }

    if (driver === "mysql") {
      const rows = await connection.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
      const row = rows[0];
      return row ? { name: row.Field, type: row.Type, primary: row.Key === "PRI", autoIncrement: String(row.Extra || "").toLowerCase().includes("auto_increment") } as any : null;
    }

    const rows = await connection.query(
      `SELECT c.column_name, c.data_type, COALESCE(tc.constraint_type = 'PRIMARY KEY', false) AS primary_key
       FROM information_schema.columns c
       LEFT JOIN information_schema.key_column_usage kcu
         ON c.table_schema = kcu.table_schema
        AND c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
       LEFT JOIN information_schema.table_constraints tc
         ON kcu.table_schema = tc.table_schema
        AND kcu.constraint_name = tc.constraint_name
       WHERE c.table_schema = '${schema}'
         AND c.table_name = '${table}'
         AND c.column_name = '${column}'`
    );
    const row = rows[0];
    return row ? { name: row.column_name, type: row.data_type, primary: !!row.primary_key, autoIncrement: false } as any : null;
  }
}
