import { expect, test, describe } from "bun:test";
import { Builder } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

describe("Query Builder", () => {
  test("generates basic select sql", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "users");
    builder.where("age", ">", 18).orderBy("name").limit(10);
    const sql = builder.toSql();
    expect(sql).toContain('SELECT * FROM "users"');
    expect(sql).toContain('WHERE "age" > 18');
    expect(sql).toContain('ORDER BY "name" ASC');
    expect(sql).toContain("LIMIT 10");
  });

  test("generates whereIn sql", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "users");
    builder.whereIn("id", [1, 2, 3]);
    const sql = builder.toSql();
    expect(sql).toContain('"id" IN (1, 2, 3)');
  });

  test("generates join sql", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "posts");
    builder.join("users", "posts.user_id", "=", "users.id");
    const sql = builder.toSql();
    expect(sql).toContain('INNER JOIN "users" ON "posts"."user_id" = "users"."id"');
  });

  test("inserts and retrieves rows", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    const builder = new Builder(connection, "items");
    await builder.insert({ name: "Foo" });
    const rows = await builder.get();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Foo");
  });

  test("updates rows", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE upd (id INTEGER PRIMARY KEY, name TEXT)");
    await connection.run("INSERT INTO upd (name) VALUES ('Old')");
    const builder = new Builder(connection, "upd");
    await builder.where("id", 1).update({ name: "New" });
    const rows = await builder.where("id", 1).get();
    expect(rows[0].name).toBe("New");
  });

  test("deletes rows", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE del (id INTEGER PRIMARY KEY)");
    await connection.run("INSERT INTO del (id) VALUES (1), (2)");
    const builder = new Builder(connection, "del");
    await builder.where("id", 1).delete();
    const rows = await new Builder(connection, "del").get();
    expect(rows).toHaveLength(1);
  });

  test("count returns correct number", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE cnt (id INTEGER PRIMARY KEY)");
    await connection.run("INSERT INTO cnt (id) VALUES (1), (2), (3)");
    const builder = new Builder(connection, "cnt");
    const count = await builder.count();
    expect(count).toBe(3);
  });

  test("pluck returns array of values", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk (name TEXT)");
    await connection.run("INSERT INTO plk (name) VALUES ('a'), ('b')");
    const builder = new Builder(connection, "plk");
    const names = await builder.pluck("name");
    expect(names).toEqual(["a", "b"]);
  });

  test("exists returns boolean", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE ex (id INTEGER PRIMARY KEY)");
    const builder = new Builder(connection, "ex");
    expect(await builder.where("id", 1).exists()).toBe(false);
    await connection.run("INSERT INTO ex (id) VALUES (1)");
    expect(await builder.where("id", 1).exists()).toBe(true);
  });
});
