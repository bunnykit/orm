import { expect, test, describe, beforeEach } from "bun:test";
import { DB, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class User extends Model {
  static override table = "users";
}

class Post extends Model {
  static override table = "posts";
}

async function setupTables() {
  const connection = setupTestDb();
  await Schema.create("users", (t) => {
    t.increments("id");
    t.string("name");
    t.timestamps();
  });
  await Schema.create("posts", (t) => {
    t.increments("id");
    t.string("title");
    t.integer("user_id");
    t.timestamps();
  });
  return connection;
}

describe("TransactionContext", () => {
  test("Model.create() inside DB.transaction() uses trx automatically", async () => {
    await setupTables();

    await DB.transaction(async () => {
      await User.create({ name: "Alice" });
      await Post.create({ title: "Hello", user_id: 1 });
    });

    expect(await User.count()).toBe(1);
    expect(await Post.count()).toBe(1);
  });

  test("rollback reverts all models created without explicit trx", async () => {
    await setupTables();

    await expect(
      DB.transaction(async () => {
        await User.create({ name: "Bob" });
        await Post.create({ title: "Rolled back", user_id: 1 });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    expect(await User.count()).toBe(0);
    expect(await Post.count()).toBe(0);
  });

  test("DB.table() inside transaction uses trx automatically", async () => {
    await setupTables();

    await DB.transaction(async () => {
      await DB.table("users").insert({ name: "Carol" });
      await DB.table("posts").insert({ title: "Via DB.table", user_id: 1 });
    });

    expect(await User.count()).toBe(1);
    expect(await Post.count()).toBe(1);
  });

  test("DB.table() rollback reverts inserts", async () => {
    await setupTables();

    await expect(
      DB.transaction(async () => {
        await DB.table("users").insert({ name: "Dave" });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    expect(await User.count()).toBe(0);
  });

  test("queries outside transaction are unaffected", async () => {
    await setupTables();

    await User.create({ name: "Outside" });

    await expect(
      DB.transaction(async () => {
        await User.create({ name: "Inside" });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    const users = await User.all();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Outside");
  });

  test("nested transactions use savepoints", async () => {
    await setupTables();

    await DB.transaction(async () => {
      await User.create({ name: "Outer" });

      await expect(
        DB.transaction(async () => {
          await User.create({ name: "Inner" });
          throw new Error("inner abort");
        })
      ).rejects.toThrow("inner abort");
    });

    const users = await User.all();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Outer");
  });
});
