import { Connection } from "../connection/Connection.js";
import { Blueprint } from "./Blueprint.js";
import { Grammar } from "./grammars/Grammar.js";
import { SQLiteGrammar } from "./grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "./grammars/MySqlGrammar.js";
import { PostgresGrammar } from "./grammars/PostgresGrammar.js";

export class Schema {
  static connection: Connection;

  static setConnection(connection: Connection): void {
    this.connection = connection;
  }

  static getConnection(): Connection {
    if (!this.connection) {
      throw new Error("No database connection set.");
    }
    return this.connection;
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
    const sql = grammar.compileCreate(blueprint, table);
    await this.getConnection().run(sql);

    const indexes = grammar.compileIndexes(blueprint, table);
    for (const indexSql of indexes) {
      await this.getConnection().run(indexSql);
    }
  }

  static async createIfNotExists(table: string, callback: (blueprint: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    const grammar = this.getGrammar();
    const sql = grammar.compileCreateIfNotExists(blueprint, table);
    await this.getConnection().run(sql);

    const indexes = grammar.compileIndexes(blueprint, table);
    for (const indexSql of indexes) {
      await this.getConnection().run(indexSql);
    }
  }

  static async table(table: string, callback: (blueprint: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    const grammar = this.getGrammar();

    for (const command of blueprint.commands) {
      if (command.name === "dropColumn") {
        const sql = grammar.compileDropColumn(table, command.parameters!.column);
        if (Array.isArray(sql)) {
          for (const s of sql) await this.getConnection().run(s);
        } else {
          await this.getConnection().run(sql);
        }
      } else if (command.name === "renameColumn") {
        const sql = grammar.compileColumnRename(table, command.parameters!.from, command.parameters!.to);
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

    const addSqls = grammar.compileAdd(blueprint, table);
    for (const sql of addSqls) {
      await this.getConnection().run(sql);
    }

    const indexes = grammar.compileIndexes(blueprint, table);
    for (const indexSql of indexes) {
      await this.getConnection().run(indexSql);
    }

    const fks = grammar.compileForeignKeys(blueprint, table);
    for (const fkSql of fks) {
      await this.getConnection().run(fkSql);
    }
  }

  static async drop(table: string): Promise<void> {
    const grammar = this.getGrammar();
    await this.getConnection().run(grammar.compileDrop(table));
  }

  static async dropIfExists(table: string): Promise<void> {
    const grammar = this.getGrammar();
    await this.getConnection().run(grammar.compileDropIfExists(table));
  }

  static async rename(from: string, to: string): Promise<void> {
    const grammar = this.getGrammar();
    await this.getConnection().run(grammar.compileRename(from, to));
  }

  static async hasTable(table: string): Promise<boolean> {
    const driver = this.getConnection().getDriverName();
    let sql: string;
    if (driver === "sqlite") {
      sql = `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`;
    } else if (driver === "mysql") {
      sql = `SHOW TABLES LIKE '${table}'`;
    } else {
      sql = `SELECT * FROM information_schema.tables WHERE table_name = '${table}'`;
    }
    const result = await this.getConnection().query(sql);
    return result.length > 0;
  }

  static async hasColumn(table: string, column: string): Promise<boolean> {
    const driver = this.getConnection().getDriverName();
    let sql: string;
    if (driver === "sqlite") {
      sql = `PRAGMA table_info(${table})`;
      const result = await this.getConnection().query(sql);
      return result.some((row: any) => row.name === column);
    } else if (driver === "mysql") {
      sql = `SHOW COLUMNS FROM ${table} LIKE '${column}'`;
    } else {
      sql = `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`;
    }
    const result = await this.getConnection().query(sql);
    return result.length > 0;
  }
}
