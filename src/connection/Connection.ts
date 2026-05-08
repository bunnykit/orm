import { SQL } from "bun";
import type { ConnectionConfig } from "../types/index.js";

export class Connection {
  readonly driver: SQL;
  private driverName: "sqlite" | "mysql" | "postgres";

  constructor(config: ConnectionConfig) {
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

    this.driver = new SQL(url);
    this.driverName = url.startsWith("sqlite")
      ? "sqlite"
      : url.startsWith("mysql")
      ? "mysql"
      : "postgres";
  }

  getDriverName(): "sqlite" | "mysql" | "postgres" {
    return this.driverName;
  }

  async query(sqlString: string): Promise<any[]> {
    // Use unsafe for generated SQL strings
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
}
