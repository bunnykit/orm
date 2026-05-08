import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class GuardedModel extends Model {
  static table = "guarded";
  static guarded = ["id", "role"];
}

class FillableModel extends Model {
  static table = "fillable";
  static fillable = ["name", "email"];
}

describe("Mass Assignment Protection", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("guarded", (table) => {
      table.increments("id");
      table.string("name");
      table.string("role").nullable();
      table.timestamps();
    });
    await Schema.create("fillable", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").nullable();
      table.string("secret").nullable();
      table.timestamps();
    });
  });

  test("guarded prevents filling protected fields", async () => {
    const record = await GuardedModel.create({ name: "Alice", role: "admin" });
    expect(record.getAttribute("name")).toBe("Alice");
    expect(record.getAttribute("role")).toBeUndefined();
  });

  test("fillable only allows specified fields", async () => {
    const record = await FillableModel.create({ name: "Bob", email: "bob@example.com", secret: "hidden" });
    expect(record.getAttribute("name")).toBe("Bob");
    expect(record.getAttribute("email")).toBe("bob@example.com");
    expect(record.getAttribute("secret")).toBeUndefined();
  });

  test("setAttribute bypasses fillable/guarded", () => {
    const record = new FillableModel();
    record.setAttribute("secret", "set directly");
    expect(record.getAttribute("secret")).toBe("set directly");
  });
});
