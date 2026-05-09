import { expect, test, describe } from "bun:test";
import { Builder, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

describe("Parameterized Queries", () => {
  function captureExecution(connection: any) {
    const calls: { method: string; sql: string; bindings: any[] }[] = [];

    const originalQuery = connection.query.bind(connection);
    connection.query = async (sql: string, bindings?: any[]) => {
      calls.push({ method: "query", sql, bindings: bindings || [] });
      return originalQuery(sql, bindings);
    };

    const originalRun = connection.run.bind(connection);
    connection.run = async (sql: string, bindings?: any[]) => {
      calls.push({ method: "run", sql, bindings: bindings || [] });
      return originalRun(sql, bindings);
    };

    return calls;
  }

  test("get() uses placeholders and bindings for WHERE", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
    await connection.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");

    const calls = captureExecution(connection);
    const builder = new Builder(connection, "users");
    await builder.where("age", ">", 18).where("name", "Alice").get();

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("WHERE \"age\" > ?");
    expect(calls[0].sql).toContain("AND \"name\" = ?");
    expect(calls[0].bindings).toEqual([18, "Alice"]);
  });

  test("first() uses placeholders and bindings", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").where("id", 5).first();

    expect(calls[0].sql).toContain("WHERE \"id\" = ?");
    expect(calls[0].bindings).toEqual([5]);
  });

  test("whereIn() uses placeholders for array values", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").whereIn("id", [1, 2, 3]).get();

    expect(calls[0].sql).toContain("\"id\" IN (?, ?, ?)");
    expect(calls[0].bindings).toEqual([1, 2, 3]);
  });

  test("whereBetween() uses placeholders for range values", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, age INTEGER)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").whereBetween("age", [18, 65]).get();

    expect(calls[0].sql).toContain("\"age\" BETWEEN ? AND ?");
    expect(calls[0].bindings).toEqual([18, 65]);
  });

  test("insert() uses placeholders and bindings", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").insert({ name: "Bob", age: 25 });

    expect(calls[0].sql).toContain("VALUES (?, ?)");
    expect(calls[0].bindings).toEqual(["Bob", 25]);
  });

  test("insert() with multiple records uses placeholders for all values", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").insert([
      { name: "Alice" },
      { name: "Bob" },
    ]);

    expect(calls[0].sql).toContain("VALUES (?), (?)");
    expect(calls[0].bindings).toEqual(["Alice", "Bob"]);
  });

  test("update() uses placeholders for SET and WHERE", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    await connection.run("INSERT INTO users (name) VALUES ('Old')");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").where("id", 1).update({ name: "New" });

    expect(calls[0].sql).toContain("SET \"name\" = ?");
    expect(calls[0].sql).toContain("WHERE \"id\" = ?");
    expect(calls[0].bindings).toEqual(["New", 1]);
  });

  test("delete() uses placeholders for WHERE", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").where("id", 7).delete();

    expect(calls[0].sql).toContain("WHERE \"id\" = ?");
    expect(calls[0].bindings).toEqual([7]);
  });

  test("increment() uses placeholders for extra values and WHERE", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, counter INTEGER, name TEXT)");
    await connection.run("INSERT INTO users (counter, name) VALUES (0, 'X')");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").where("id", 1).increment("counter", 5, { name: "Y" });

    expect(calls[0].sql).toContain("SET \"counter\" = \"counter\" + 5");
    expect(calls[0].sql).toContain("\"name\" = ?");
    expect(calls[0].sql).toContain("WHERE \"id\" = ?");
    expect(calls[0].bindings).toEqual(["Y", 1]);
  });

  test("toSql() still returns inline SQL for backward compat", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "users");
    builder.where("age", ">", 18).whereIn("id", [1, 2]);

    const sql = builder.toSql();
    expect(sql).toContain('"age" > 18');
    expect(sql).toContain('"id" IN (1, 2)');
    expect(builder.bindings).toEqual([]);
  });

  test("handles SQL injection attempts safely via parameterization", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    await connection.run("INSERT INTO users (name) VALUES ('Alice')");

    const malicious = "'; DROP TABLE users; --";
    const calls = captureExecution(connection);
    const rows = await new Builder(connection, "users").where("name", malicious).get();

    expect(calls[0].sql).toContain("WHERE \"name\" = ?");
    expect(calls[0].bindings).toEqual([malicious]);
    expect(rows).toHaveLength(0);

    const check = await connection.query('SELECT name FROM users');
    expect(check).toHaveLength(1);
  });

  test("nested where clauses use placeholders and bindings", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
    await connection.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");

    const malicious = "CURRENT_TIMESTAMP OR 1=1 --";
    const calls = captureExecution(connection);
    const rows = await new Builder(connection, "users")
      .where((query) => {
        query.where("name", malicious).orWhere("age", 99);
      })
      .get();

    expect(calls[0].sql).toContain('WHERE ("name" = ? OR "age" = ?)');
    expect(calls[0].sql).not.toContain(malicious);
    expect(calls[0].bindings).toEqual([malicious, 99]);
    expect(rows).toHaveLength(0);
  });

  test("handles strings containing commas safely in update", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE items (id INTEGER PRIMARY KEY, desc TEXT)");
    await connection.run("INSERT INTO items (desc) VALUES ('old')");

    const calls = captureExecution(connection);
    await new Builder(connection, "items").where("id", 1).update({ desc: "hello, world" });

    expect(calls[0].sql).toContain("\"desc\" = ?");
    expect(calls[0].bindings).toEqual(["hello, world", 1]);

    const rows = await new Builder(connection, "items").where("id", 1).get();
    expect((rows[0] as any).desc).toBe("hello, world");
  });

  test("having() uses placeholders and bindings", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER)");
    await connection.run("INSERT INTO orders (total) VALUES (100), (200), (300)");

    const calls = captureExecution(connection);
    await new Builder(connection, "orders")
      .groupBy("id")
      .having("total", ">", 150)
      .get();

    expect(calls[0].sql).toContain("HAVING \"total\" > ?");
    expect(calls[0].bindings).toContain(150);
  });

  test("insertOrIgnore() uses placeholders", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT UNIQUE)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").insertOrIgnore({ name: "Dup" });

    expect(calls[0].sql).toContain("VALUES (?)");
    expect(calls[0].bindings).toEqual(["Dup"]);
  });

  test("upsert() uses placeholders", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT)");

    const calls = captureExecution(connection);
    await new Builder(connection, "users").upsert(
      { email: "a@b.com", name: "Alice" },
      "email",
      ["name"]
    );

    expect(calls[0].sql).toContain("VALUES (?, ?)");
    expect(calls[0].bindings).toEqual(["a@b.com", "Alice"]);
  });

  test("cursor() fetches in batches instead of one row per query", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE nums (id INTEGER PRIMARY KEY)");
    await connection.run("INSERT INTO nums (id) VALUES (1), (2), (3), (4), (5)");

    const calls = captureExecution(connection);
    const builder = new Builder(connection, "nums").orderBy("id");
    const results: number[] = [];

    for await (const row of builder.cursor(2)) {
      results.push((row as any).id);
    }

    expect(results).toEqual([1, 2, 3, 4, 5]);
    // With chunkSize=2 and 5 rows, we expect 3 queries (2+2+1), not 5 queries
    const queryCalls = calls.filter((c) => c.method === "query");
    expect(queryCalls).toHaveLength(3);

    // Verify keyset pagination is used (no OFFSET)
    expect(queryCalls[1].sql).not.toContain("OFFSET");
    expect(queryCalls[1].sql).toContain('"id" > ?');
    expect(queryCalls[1].bindings).toEqual([2]);

    expect(queryCalls[2].sql).toContain('"id" > ?');
    expect(queryCalls[2].bindings).toEqual([4]);
  });

  test("cursor() does not skip duplicate values when ordered by a non-unique column", async () => {
    const connection = setupTestDb();
    Schema.setConnection(connection);

    class CursorItem extends Model {
      static table = "cursor_items";
      static timestamps = false;
    }
    CursorItem.setConnection(connection);

    await Schema.create("cursor_items", (table) => {
      table.increments("id");
      table.string("group_name");
    });
    await CursorItem.create({ group_name: "a" });
    await CursorItem.create({ group_name: "a" });
    await CursorItem.create({ group_name: "b" });

    const seen: string[] = [];
    for await (const item of CursorItem.orderBy("group_name").cursor(1)) {
      seen.push(`${item.id}:${item.group_name}`);
    }

    expect(seen).toEqual(["1:a", "2:a", "3:b"]);
  });
});
