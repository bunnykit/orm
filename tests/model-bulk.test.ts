import { beforeAll, describe, expect, test } from "bun:test";
import { Model, ObserverRegistry, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class BulkUser extends Model {
  static table = "bulk_users";
  static fillable = ["name", "email", "active", "role"];
  static casts = {
    active: "boolean",
  };
}

class BulkUuidUser extends Model {
  static table = "bulk_uuid_users";
  static keyType = "uuid";
  static fillable = ["name"];
}

describe("Bulk model operations", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("bulk_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").unique();
      table.boolean("active").default(false);
      table.string("role").nullable();
      table.timestamps();
    });
    await Schema.create("bulk_uuid_users", (table) => {
      table.uuid("id").primary();
      table.string("name");
      table.timestamps();
    });
  });

  test("insert applies fillable, casts, timestamps, and chunking", async () => {
    await BulkUser.insert([
      { name: "Insert A", email: "insert-a@example.test", active: true, ignored: "nope" },
      { name: "Insert B", email: "insert-b@example.test", active: false, ignored: "nope" },
    ], { chunkSize: 1 });

    const rows = await BulkUser.whereIn("email", ["insert-a@example.test", "insert-b@example.test"]).orderBy("email").get();

    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("active")).toBe(true);
    expect(rows[0].getAttribute("created_at")).toBeDefined();
    expect(rows[0].getAttribute("ignored")).toBeUndefined();
  });

  test("insert generates uuid primary keys for bulk uuid models", async () => {
    await BulkUuidUser.insert([{ name: "Uuid A" }, { name: "Uuid B" }]);
    const rows = await BulkUuidUser.orderBy("name").get();

    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("id")).toMatch(/[0-9a-f-]{36}/);
  });

  test("upsert creates and updates through the model API", async () => {
    await BulkUser.upsert({ name: "Upsert A", email: "upsert@example.test", active: false }, "email");
    await BulkUser.upsert({ name: "Upsert B", email: "upsert@example.test", active: true }, "email");

    const row = await BulkUser.where("email", "upsert@example.test").first();

    expect(row?.getAttribute("name")).toBe("Upsert B");
    expect(row?.getAttribute("active")).toBe(true);
  });

  test("updateOrInsert updates existing rows or inserts new rows", async () => {
    await BulkUser.updateOrInsert(
      { email: "update-or-insert@example.test" },
      { name: "Created", active: false }
    );
    await BulkUser.updateOrInsert(
      { email: "update-or-insert@example.test" },
      { name: "Updated", active: true }
    );

    const rows = await BulkUser.where("email", "update-or-insert@example.test").get();

    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("name")).toBe("Updated");
    expect(rows[0].getAttribute("active")).toBe(true);
  });

  test("createMany saves models with events by default", async () => {
    const events: string[] = [];
    ObserverRegistry.register(BulkUser, {
      creating(model) {
        if (String(model.getAttribute("email")).startsWith("create-many")) events.push("creating");
      },
      created(model) {
        if (String(model.getAttribute("email")).startsWith("create-many")) events.push("created");
      },
    });

    const users = await BulkUser.createMany([
      { name: "Many A", email: "create-many-a@example.test", active: true },
      { name: "Many B", email: "create-many-b@example.test", active: true },
    ]);

    expect(users.every((user) => user.$exists)).toBe(true);
    expect(events.filter((event) => event === "creating")).toHaveLength(2);
    expect(events.filter((event) => event === "created")).toHaveLength(2);
  });

  test("saveMany can bypass events for new and existing models", async () => {
    const events: string[] = [];
    ObserverRegistry.register(BulkUser, {
      saving(model) {
        if (String(model.getAttribute("email")).includes("silent")) events.push("saving");
      },
      updating(model) {
        if (String(model.getAttribute("email")).includes("silent")) events.push("updating");
      },
    });

    const [created] = await BulkUser.createMany([
      { name: "Silent A", email: "silent-a@example.test", active: true },
    ], { events: false });

    created.setAttribute("name", "Silent A Updated");
    await BulkUser.saveMany([created], { events: false });
    const refreshed = await BulkUser.where("email", "silent-a@example.test").first();

    expect(events).toEqual([]);
    expect(created.$exists).toBe(true);
    expect(refreshed?.getAttribute("name")).toBe("Silent A Updated");
  });
});
