import { SQL } from "bun";
import type { ConnectionConfig } from "../types/index.js";
import { Grammar } from "../query/grammars/Grammar.js";
import { SQLiteGrammar } from "../query/grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "../query/grammars/MySqlGrammar.js";
import { PostgresGrammar } from "../query/grammars/PostgresGrammar.js";

export class Connection {
  readonly driver: SQL;
  private driverName: "sqlite" | "mysql" | "postgres";
  private grammar: Grammar;
  private config: ConnectionConfig;
  private schema?: string;
  private ownsDriver: boolean;

  constructor(config: ConnectionConfig, options: { driver?: SQL; schema?: string; ownsDriver?: boolean } = {}) {
    this.config = config;
    this.schema = options.schema || ("schema" in config ? config.schema : undefined);
    this.ownsDriver = options.ownsDriver ?? !options.driver;
    let url: string;
    if ("url" in config && config.url) {
      url = config.url;
    } else if ("driver" in config) {
      const c = config as any;
      if (c.driver === "sqlite") {
        url = `sqlite://${c.filename || c.database || ":memory:"}`;
      } else {
        const protocol = c.driver === "mysql" ? "mysql" : "postgres";
        url = `${protocol}://${c.username || ""}:${c.password || ""}@${c.host || "localhost"}:${c.port || (c.driver === "mysql" ? 3306 : 5432)}/${c.database || ""}`;
      }
    } else {
      throw new Error("Invalid connection configuration. Provide a url or driver config.");
    }

    this.driver = options.driver || new SQL(url);
    this.driverName = url.startsWith("sqlite")
      ? "sqlite"
      : url.startsWith("mysql")
      ? "mysql"
      : "postgres";

    switch (this.driverName) {
      case "sqlite":
        this.grammar = new SQLiteGrammar();
        break;
      case "mysql":
        this.grammar = new MySqlGrammar();
        break;
      case "postgres":
        this.grammar = new PostgresGrammar();
        break;
    }
  }

  getDriverName(): "sqlite" | "mysql" | "postgres" {
    return this.driverName;
  }

  getGrammar(): Grammar {
    return this.grammar;
  }

  getSchema(): string | undefined {
    return this.schema;
  }

  withSchema(schema: string): Connection {
    if (this.schema === schema) return this;
    return new Connection(this.config, { driver: this.driver, schema, ownsDriver: false });
  }

  withoutSchema(): Connection {
    if (!this.schema) return this;
    return new Connection(this.config, { driver: this.driver, ownsDriver: false });
  }

  qualifyTable(table: string): string {
    if (!this.schema || this.driverName === "sqlite" || table.includes(".")) return table;
    return `${this.schema}.${table}`;
  }

  private quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  async query(sqlString: string): Promise<any[]> {
    return (await this.driver.unsafe(sqlString)) as any[];
  }

  async run(sqlString: string): Promise<any> {
    return await this.driver.unsafe(sqlString);
  }

  async beginTransaction(): Promise<void> {
    await this.driver.unsafe("BEGIN");
  }

  async commit(): Promise<void> {
    await this.driver.unsafe("COMMIT");
  }

  async rollback(): Promise<void> {
    await this.driver.unsafe("ROLLBACK");
  }

  async transaction<T>(callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    return await this.driver.begin(async (sql) => {
      const connection = new Connection(this.config, {
        driver: sql as unknown as SQL,
        schema: this.schema,
        ownsDriver: false,
      });
      return await callback(connection);
    });
  }

  async withTenant<T>(
    tenantId: string,
    callback: (connection: Connection) => T | Promise<T>,
    setting: string = "app.tenant_id"
  ): Promise<T> {
    if (this.driverName !== "postgres") {
      return await this.transaction(callback);
    }
    return await this.transaction(async (connection) => {
      await connection.run(`SET LOCAL ${setting} = ${connection.getGrammar().escape(tenantId)}`);
      return await callback(connection);
    });
  }

  async withSearchPath<T>(schema: string, callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    if (this.driverName !== "postgres") {
      throw new Error("search_path schema switching is only supported for PostgreSQL connections.");
    }
    return await this.transaction(async (connection) => {
      await connection.run(`SET LOCAL search_path TO ${connection.quoteIdentifier(schema)}`);
      return await callback(connection.withoutSchema());
    });
  }

  async close(): Promise<void> {
    if (this.ownsDriver) {
      await this.driver.close();
    }
  }
}
