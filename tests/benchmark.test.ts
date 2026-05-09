import { test, describe, beforeAll, afterAll } from "bun:test";
import { Model, Schema, Connection } from "../src/index.js";

function setupDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return connection;
}

class BenchUser extends Model {
  static table = "bench_users";
  static casts = { active: "boolean" };
  static attributes = { role: "member" };
}

class BenchPost extends Model {
  static table = "bench_posts";
  static fillable = ["title", "body"];
}

describe("Benchmark: Common Operations", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = setupDb();
    await Schema.create("bench_users", (t) => {
      t.increments("id");
      t.string("name");
      t.string("email").unique();
      t.boolean("active");
      t.string("role");
      t.timestamps();
    });
    await Schema.create("bench_posts", (t) => {
      t.increments("id");
      t.string("title");
      t.text("body").nullable();
      t.timestamps();
    });
  });

  afterAll(async () => {
    await connection.driver.close();
  });

  async function resetTable() {
    await connection.query("DELETE FROM bench_users");
    await connection.query("DELETE FROM bench_posts");
  }

  // Single record operations
  test("Model.create x100", async () => {
    await resetTable();
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchUser.create({ name: `U${i}`, email: `c${i}@t.com`, active: true });
    }
    const ms = performance.now() - start;
    console.log(`  Model.create x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  test("new + save x100", async () => {
    await resetTable();
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const u = new BenchUser({ name: `U${i}`, email: `s${i}@t.com`, active: true });
      await u.save();
    }
    const ms = performance.now() - start;
    console.log(`  new + save x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  test("Model.find x100", async () => {
    const u = await BenchUser.create({ name: "F", email: "find@t.com", active: true });
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchUser.find(u.id);
    }
    const ms = performance.now() - start;
    console.log(`  Model.find x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  test("where().first x100", async () => {
    await resetTable();
    await BenchUser.create({ name: "X", email: "x@t.com", active: true });
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchUser.where("id", ">", 0).first();
    }
    const ms = performance.now() - start;
    console.log(`  where().first x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  test("Model.all x50", async () => {
    await BenchUser.create({ name: "A", email: "all@t.com", active: true });
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      await BenchUser.all();
    }
    const ms = performance.now() - start;
    console.log(`  Model.all x50: ${ms.toFixed(2)}ms (${(ms / 50).toFixed(3)}ms/op)`);
  });

  // Bulk operations
  test("Model.insert x1000 (chunk 500)", async () => {
    await resetTable();
    const data = Array.from({ length: 1000 }, (_, i) => ({
      name: `U${i}`, email: `i${i}@t.com`, active: true,
    }));
    const start = performance.now();
    await BenchUser.insert(data, { chunkSize: 500 });
    const ms = performance.now() - start;
    console.log(`  Model.insert x1000 (chunk): ${ms.toFixed(2)}ms (${(ms / 1000).toFixed(4)}ms/op)`);
  });

  test("Model.insert x1000 (no chunk)", async () => {
    await resetTable();
    const data = Array.from({ length: 1000 }, (_, i) => ({
      name: `U${i}`, email: `i${i}@t.com`, active: true,
    }));
    const start = performance.now();
    await BenchUser.insert(data);
    const ms = performance.now() - start;
    console.log(`  Model.insert x1000 (no chunk): ${ms.toFixed(2)}ms (${(ms / 1000).toFixed(4)}ms/op)`);
  });

  test("Model.createMany x500", async () => {
    await resetTable();
    const data = Array.from({ length: 500 }, (_, i) => ({
      name: `U${i}`, email: `cm${i}@t.com`, active: true,
    }));
    const start = performance.now();
    await BenchUser.createMany(data);
    const ms = performance.now() - start;
    console.log(`  Model.createMany x500: ${ms.toFixed(2)}ms (${(ms / 500).toFixed(3)}ms/op)`);
  });

  test("Model.createMany x500 (events:false)", async () => {
    await resetTable();
    const data = Array.from({ length: 500 }, (_, i) => ({
      name: `U${i}`, email: `cm${i}@t.com`, active: true,
    }));
    const start = performance.now();
    await BenchUser.createMany(data, { events: false });
    const ms = performance.now() - start;
    console.log(`  Model.createMany x500 (no events): ${ms.toFixed(2)}ms (${(ms / 500).toFixed(3)}ms/op)`);
  });

  test("Model.saveMany x200 (new)", async () => {
    await resetTable();
    const users = Array.from({ length: 200 }, (_, i) =>
      new BenchUser({ name: `U${i}`, email: `sm${i}@t.com`, active: true })
    );
    const start = performance.now();
    await BenchUser.saveMany(users);
    const ms = performance.now() - start;
    console.log(`  Model.saveMany x200: ${ms.toFixed(2)}ms (${(ms / 200).toFixed(3)}ms/op)`);
  });

  test("loop create x100", async () => {
    await resetTable();
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchPost.create({ title: `P${i}`, body: "b" });
    }
    const ms = performance.now() - start;
    console.log(`  loop create x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  // Update operations
  test("update single x50", async () => {
    const u = await BenchUser.create({ name: "U", email: "up@t.com", active: true });
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      u.name = `U${i}`;
      await u.save();
    }
    const ms = performance.now() - start;
    console.log(`  update single x50: ${ms.toFixed(2)}ms (${(ms / 50).toFixed(3)}ms/op)`);
  });

  test("where().update x50 (limit 10)", async () => {
    await BenchUser.create({ name: "X", email: "xu@t.com", active: true });
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      await BenchUser.where("id", ">", 0).limit(10).update({ role: "admin" });
    }
    const ms = performance.now() - start;
    console.log(`  where().update x50: ${ms.toFixed(2)}ms (${(ms / 50).toFixed(3)}ms/op)`);
  });

  // Query operations
  test("where().get x100 (limit 50)", async () => {
    await resetTable();
    await BenchUser.insert(Array.from({ length: 100 }, (_, i) => ({
      name: `U${i}`, email: `g${i}@t.com`, active: true,
    })));
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchUser.where("id", ">", 0).limit(50).get();
    }
    const ms = performance.now() - start;
    console.log(`  where().get x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  test("where().pluck x100", async () => {
    await resetTable();
    await BenchUser.insert(Array.from({ length: 100 }, (_, i) => ({
      name: `U${i}`, email: `p${i}@t.com`, active: true,
    })));
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchUser.where("id", ">", 0).pluck("name");
    }
    const ms = performance.now() - start;
    console.log(`  where().pluck x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  test("where().count x100", async () => {
    await resetTable();
    await BenchUser.insert(Array.from({ length: 100 }, (_, i) => ({
      name: `U${i}`, email: `cn${i}@t.com`, active: true,
    })));
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchUser.where("id", ">", 0).count();
    }
    const ms = performance.now() - start;
    console.log(`  where().count x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });

  // Upsert
  test("Model.upsert x500 (insert)", async () => {
    await resetTable();
    const data = Array.from({ length: 500 }, (_, i) => ({
      name: `U${i}`, email: `u${i}@t.com`, active: true, role: "member",
    }));
    const start = performance.now();
    await BenchUser.upsert(data, "email", ["name", "role"], { chunkSize: 250 });
    const ms = performance.now() - start;
    console.log(`  Model.upsert x500 (insert): ${ms.toFixed(2)}ms (${(ms / 500).toFixed(3)}ms/op)`);
  });

  test("Model.upsert x500 (update)", async () => {
    // Same emails, should update
    const data = Array.from({ length: 500 }, (_, i) => ({
      name: `U${i} updated`, email: `u${i}@t.com`, active: true, role: "admin",
    }));
    const start = performance.now();
    await BenchUser.upsert(data, "email", ["name", "role"], { chunkSize: 250 });
    const ms = performance.now() - start;
    console.log(`  Model.upsert x500 (update): ${ms.toFixed(2)}ms (${(ms / 500).toFixed(3)}ms/op)`);
  });

  test("Model.updateOrInsert x100", async () => {
    await resetTable();
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await BenchUser.updateOrInsert(
        { email: `uoi${i}@t.com` },
        { name: `U${i}`, active: true }
      );
    }
    const ms = performance.now() - start;
    console.log(`  Model.updateOrInsert x100: ${ms.toFixed(2)}ms (${(ms / 100).toFixed(3)}ms/op)`);
  });
});