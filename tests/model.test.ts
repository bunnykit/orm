import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class TestUser extends Model {
  static table = "test_users";
}

class DefaultUser extends Model {
  static table = "default_users";
  static casts = {
    active: "boolean",
  };
  static attributes = {
    name: "Guest",
    active: true,
    role: "member",
  };
}

class UuidUser extends Model {
  static table = "uuid_users";
}

describe("Model", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("test_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").nullable();
      table.timestamps();
    });
    await Schema.create("default_users", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active");
      table.string("role");
      table.timestamps();
    });
    await Schema.create("uuid_users", (table) => {
      table.uuid("id").primary();
      table.string("name");
      table.timestamps();
    });
  });

  test("create returns model instance", async () => {
    const user = await TestUser.create({ name: "Alice", email: "a@example.com" });
    expect(user).toBeInstanceOf(TestUser);
    expect(user.getAttribute("name")).toBe("Alice");
    expect(user.$exists).toBe(true);
    expect(user.getAttribute("id")).toBeDefined();
  });

  test("find retrieves existing model", async () => {
    const created = await TestUser.create({ name: "Bob" });
    const found = await TestUser.find(created.getAttribute("id"));
    expect(found).not.toBeNull();
    expect(found!.getAttribute("name")).toBe("Bob");
    expect(found!.$exists).toBe(true);
  });

  test("find returns null for missing id", async () => {
    const found = await TestUser.find(99999);
    expect(found).toBeNull();
  });

  test("save updates existing model", async () => {
    const user = await TestUser.create({ name: "Carl" });
    user.setAttribute("name", "Carl Updated");
    await user.save();
    const refreshed = await TestUser.find(user.getAttribute("id"));
    expect(refreshed!.getAttribute("name")).toBe("Carl Updated");
  });

  test("delete removes model", async () => {
    const user = await TestUser.create({ name: "Dan" });
    const id = user.getAttribute("id");
    await user.delete();
    expect(user.$exists).toBe(false);
    const found = await TestUser.find(id);
    expect(found).toBeNull();
  });

  test("fill populates attributes", () => {
    const user = new TestUser();
    user.fill({ name: "Eve", email: "eve@example.com" });
    expect(user.getAttribute("name")).toBe("Eve");
    expect(user.getAttribute("email")).toBe("eve@example.com");
  });

  test("getDirty tracks changed attributes", () => {
    const user = new TestUser({ name: "Frank" });
    expect(user.isDirty()).toBe(true);
    user.save = async () => user; // mock save to avoid db call
    user.$exists = true;
    user.$original = { ...user.$attributes };
    expect(user.isDirty()).toBe(false);
    user.setAttribute("name", "Frankie");
    expect(user.isDirty()).toBe(true);
    expect(user.getDirty()).toEqual({ name: "Frankie" });
  });

  test("sets timestamps on create", async () => {
    const user = await TestUser.create({ name: "Grace" });
    expect(user.getAttribute("created_at")).toBeDefined();
    expect(user.getAttribute("updated_at")).toBeDefined();
  });

  test("updates updated_at on save", async () => {
    const user = await TestUser.create({ name: "Hank" });
    const oldUpdated = user.getAttribute("updated_at");
    await new Promise((r) => setTimeout(r, 10));
    user.setAttribute("name", "Hank 2");
    await user.save();
    expect(user.getAttribute("updated_at")).not.toBe(oldUpdated);
  });

  test("toJSON returns plain object", async () => {
    const user = await TestUser.create({ name: "Ivy" });
    const json = user.toJSON();
    expect(json.name).toBe("Ivy");
    expect(json).not.toHaveProperty("$exists");
  });

  test("all returns all records", async () => {
    await TestUser.create({ name: "Jack" });
    const all = await TestUser.all();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0]).toBeInstanceOf(TestUser);
  });

  test("where returns builder", async () => {
    await TestUser.create({ name: "Kate" });
    const results = await TestUser.where("name", "Kate").get();
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("applies default attributes to new models", () => {
    const user = new DefaultUser();
    expect(user.getAttribute("name")).toBe("Guest");
    expect(user.getAttribute("active")).toBe(true);
    expect(user.getAttribute("role")).toBe("member");
  });

  test("provided attributes override default attributes", () => {
    const user = new DefaultUser({ name: "Ada", role: "admin" });
    expect(user.getAttribute("name")).toBe("Ada");
    expect(user.getAttribute("active")).toBe(true);
    expect(user.getAttribute("role")).toBe("admin");
  });

  test("create persists default attributes", async () => {
    const user = await DefaultUser.create({ name: "Persisted" });
    const found = await DefaultUser.find(user.getAttribute("id"));
    expect(found!.getAttribute("name")).toBe("Persisted");
    expect(found!.getAttribute("active")).toBe(true);
    expect(found!.getAttribute("role")).toBe("member");
  });

  test("attributes can be read and written as model properties", async () => {
    const user = new DefaultUser({ name: "Property User" });

    expect(user.name).toBe("Property User");
    expect(user.active).toBe(true);
    expect(user.role).toBe("member");

    user.role = "admin";
    user.active = false;

    expect(user.getAttribute("role")).toBe("admin");
    expect(user.getAttribute("active")).toBe(false);
    expect(user.getDirty()).toMatchObject({ name: "Property User", role: "admin", active: 0 });
  });

  test("hydrated models expose attributes as properties", async () => {
    const created = await DefaultUser.create({ name: "Hydrated" });
    const found = await DefaultUser.find(created.id);

    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe("Hydrated");
    expect(found!.active).toBe(true);
  });

  test("auto-generates uuid primary keys", async () => {
    const created = await UuidUser.create({ name: "Uuid User" });
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const found = await UuidUser.find(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Uuid User");
  });
});
