import { expect, test, describe } from "bun:test";
import { Connection } from "../src/index.js";

describe("Connection", () => {
  test("creates connection from sqlite url", () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    expect(conn.getDriverName()).toBe("sqlite");
  });

  test("creates connection from mysql url", () => {
    const conn = new Connection({ url: "mysql://user:pass@localhost:3306/db" });
    expect(conn.getDriverName()).toBe("mysql");
  });

  test("creates connection from postgres url", () => {
    const conn = new Connection({ url: "postgres://user:pass@localhost:5432/db" });
    expect(conn.getDriverName()).toBe("postgres");
  });

  test("creates connection from driver config (sqlite)", () => {
    const conn = new Connection({ driver: "sqlite", filename: ":memory:" });
    expect(conn.getDriverName()).toBe("sqlite");
  });

  test("creates connection from driver config (mysql)", () => {
    const conn = new Connection({ driver: "mysql", host: "localhost", database: "db" });
    expect(conn.getDriverName()).toBe("mysql");
  });

  test("runs and queries sql", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    await conn.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await conn.run("INSERT INTO test (name) VALUES ('Alice')");
    const rows = await conn.query("SELECT * FROM test WHERE name = 'Alice'");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Alice");
  });

  test("supports transactions", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    await conn.run("CREATE TABLE tx_test (id INTEGER PRIMARY KEY)");
    await conn.beginTransaction();
    await conn.run("INSERT INTO tx_test (id) VALUES (1)");
    await conn.rollback();
    const rows = await conn.query("SELECT * FROM tx_test");
    expect(rows).toHaveLength(0);
  });
});
