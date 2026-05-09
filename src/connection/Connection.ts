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
  private transactionDepth = 0;
  private savepointId = 0;
  private reservedDriver?: SQL & { release?: () => void };

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

  static isSafeIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
  }

  static assertSafeIdentifier(value: string, label: string = "identifier"): void {
    if (!this.isSafeIdentifier(value)) {
      throw new Error(`Invalid ${label}: ${value}`);
    }
  }

  static assertSafeQualifiedIdentifier(value: string, label: string = "identifier"): void {
    const parts = value.split(".");
    if (parts.length === 0 || parts.some((part) => !this.isSafeIdentifier(part))) {
      throw new Error(`Invalid ${label}: ${value}`);
    }
  }

  withSchema(schema: string): Connection {
    Connection.assertSafeIdentifier(schema, "schema name");
    if (this.schema === schema) return this;
    return new Connection(this.config, { driver: this.driver, schema, ownsDriver: false });
  }

  withoutSchema(): Connection {
    if (!this.schema) return this;
    return new Connection(this.config, { driver: this.driver, ownsDriver: false });
  }

  qualifyTable(table: string): string {
    if (table.includes(".")) {
      Connection.assertSafeQualifiedIdentifier(table, "qualified table name");
      return table;
    }
    if (!this.schema || this.driverName === "sqlite") return table;
    Connection.assertSafeIdentifier(this.schema, "schema name");
    Connection.assertSafeIdentifier(table, "table name");
    return `${this.schema}.${table}`;
  }

  quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private getDriver(): SQL {
    return this.reservedDriver || this.driver;
  }

  async query(sqlString: string, bindings?: any[]): Promise<any[]> {
    return (await this.getDriver().unsafe(sqlString, bindings)) as any[];
  }

  async run(sqlString: string, bindings?: any[]): Promise<any> {
    return await this.getDriver().unsafe(sqlString, bindings);
  }

  async beginTransaction(): Promise<void> {
    if (this.transactionDepth === 0) {
      if (this.driverName === "postgres") {
        this.reservedDriver = await (this.driver as any).reserve();
      }
      try {
        await this.getDriver().unsafe("BEGIN");
      } catch (error) {
        this.releaseReservedDriver();
        throw error;
      }
    } else {
      await this.getDriver().unsafe(`SAVEPOINT bunny_trans_${++this.savepointId}`);
    }
    this.transactionDepth++;
  }

  private releaseReservedDriver(): void {
    this.reservedDriver?.release?.();
    this.reservedDriver = undefined;
  }

  async commit(): Promise<void> {
    if (this.transactionDepth <= 0) return;
    if (this.transactionDepth === 1) {
      try {
        await this.getDriver().unsafe("COMMIT");
      } finally {
        this.transactionDepth = 0;
        this.releaseReservedDriver();
      }
    } else {
      await this.getDriver().unsafe(`RELEASE SAVEPOINT bunny_trans_${this.savepointId--}`);
      this.transactionDepth--;
    }
  }

  async rollback(): Promise<void> {
    if (this.transactionDepth <= 0) return;
    if (this.transactionDepth === 1) {
      try {
        await this.getDriver().unsafe("ROLLBACK");
      } finally {
        this.transactionDepth = 0;
        this.releaseReservedDriver();
      }
    } else {
      await this.getDriver().unsafe(`ROLLBACK TO SAVEPOINT bunny_trans_${this.savepointId}`);
      await this.getDriver().unsafe(`RELEASE SAVEPOINT bunny_trans_${this.savepointId--}`);
      this.transactionDepth--;
    }
  }

  isInTransaction(): boolean {
    return this.transactionDepth > 0;
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
    setting: string = "app.tenant_id",
    role?: string
  ): Promise<T> {
    if (this.driverName !== "postgres") {
      return await this.transaction(callback);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(setting)) {
      throw new Error(`Invalid PostgreSQL setting name: ${setting}`);
    }
    if (role) {
      Connection.assertSafeIdentifier(role, "role name");
    }
    return await this.transaction(async (connection) => {
      if (role) {
        await connection.run(`SET LOCAL ROLE ${connection.quoteIdentifier(role)}`);
      }
      await connection.run(`SELECT set_config(${connection.getGrammar().placeholder(1)}, ${connection.getGrammar().placeholder(2)}, true)`, [setting, tenantId]);
      return await callback(connection);
    });
  }

  async withSearchPath<T>(schema: string, callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    if (this.driverName !== "postgres") {
      throw new Error("search_path schema switching is only supported for PostgreSQL connections.");
    }
    Connection.assertSafeIdentifier(schema, "schema name");
    return await this.transaction(async (connection) => {
      await connection.run(`SET LOCAL search_path TO ${connection.quoteIdentifier(schema)}`);
      return await callback(connection.withoutSchema());
    });
  }

  async close(): Promise<void> {
    this.releaseReservedDriver();
    if (this.ownsDriver) {
      await this.driver.close();
    }
  }
}
