import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, type CastsAttributes } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class UppercaseCast implements CastsAttributes {
  get(_model: Model, _key: string, value: any): any {
    return String(value).toLowerCase();
  }

  set(_model: Model, _key: string, value: any): any {
    return String(value).toUpperCase();
  }
}

class CountingCast implements CastsAttributes {
  static gets = 0;

  get(_model: Model, _key: string, value: any): any {
    CountingCast.gets++;
    return String(value).toLowerCase();
  }

  set(_model: Model, _key: string, value: any): any {
    return String(value).toUpperCase();
  }
}

class CastedModel extends Model {
  static table = "casted";
  static casts = {
    is_active: "boolean",
    count: "number",
    metadata: "json",
    score: "number",
    tags: "json",
    price: "decimal:2",
    secret: "encrypted",
    code: UppercaseCast,
  };
}

class CachedCastModel extends Model {
  static table = "cached_casted";
  static casts = {
    code: CountingCast,
  };
}

describe("Attribute Casting", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("casted", (table) => {
      table.increments("id");
      table.integer("is_active").default(0);
      table.integer("count").default(0);
      table.text("metadata").nullable();
      table.float("score").default(0);
      table.text("tags").nullable();
      table.string("price").nullable();
      table.text("secret").nullable();
      table.string("code").nullable();
      table.timestamps();
    });
    await Schema.create("cached_casted", (table) => {
      table.increments("id");
      table.string("code");
    });
  });

  test("casts boolean from integer", async () => {
    const record = await CastedModel.create({ is_active: 1, count: 0, score: 0 });
    expect(record.getAttribute("is_active")).toBe(true);
    expect(typeof record.getAttribute("is_active")).toBe("boolean");
  });

  test("casts number from string/integer", async () => {
    const record = await CastedModel.create({ count: "42", is_active: 0, score: 0 });
    expect(record.getAttribute("count")).toBe(42);
    expect(typeof record.getAttribute("count")).toBe("number");
  });

  test("casts json from string", async () => {
    const record = await CastedModel.create({ metadata: JSON.stringify({ foo: "bar" }), is_active: 0, count: 0, score: 0 });
    expect(record.getAttribute("metadata")).toEqual({ foo: "bar" });
  });

  test("toJSON applies casts", async () => {
    const record = await CastedModel.create({ is_active: 1, count: 5, score: 3.14, tags: JSON.stringify(["a", "b"]) });
    const json = record.toJSON();
    expect(json.is_active).toBe(true);
    expect(json.count).toBe(5);
    expect(json.score).toBe(3.14);
    expect(json.tags).toEqual(["a", "b"]);
  });

  test("find applies casts on retrieval", async () => {
    const created = await CastedModel.create({ is_active: 1, count: 10, score: 0 });
    const found = await CastedModel.find(created.getAttribute("id"));
    expect(found!.getAttribute("is_active")).toBe(true);
    expect(found!.getAttribute("count")).toBe(10);
  });

  test("serializes json casts before storage", async () => {
    const record = await CastedModel.create({ metadata: { foo: "bar" }, is_active: 0, count: 0, score: 0 });
    expect(record.$attributes.metadata).toBe(JSON.stringify({ foo: "bar" }));
    expect(record.metadata).toEqual({ foo: "bar" });
  });

  test("supports decimal, encrypted, runtime, and custom casts", async () => {
    const record = new CastedModel({ price: 12.5, secret: "hidden", code: "abc", is_active: 0, count: 0, score: 0 });
    record.mergeCasts({ count: "string" });

    expect(record.$attributes.price).toBe("12.50");
    expect(record.price).toBe("12.50");
    expect(record.$attributes.secret).not.toBe("hidden");
    expect(record.secret).toBe("hidden");
    expect(record.$attributes.code).toBe("ABC");
    expect(record.code).toBe("abc");
    expect(record.count).toBe("0");
  });

  test("caches casted values until the attribute or casts change", () => {
    CountingCast.gets = 0;
    const record = new CachedCastModel({ code: "ABC" });

    expect(record.code).toBe("abc");
    expect(record.code).toBe("abc");
    expect(CountingCast.gets).toBe(1);

    record.code = "XYZ";
    expect(record.code).toBe("xyz");
    expect(CountingCast.gets).toBe(2);

    record.mergeCasts({ code: "string" });
    expect(record.code).toBe("XYZ");
    expect(CountingCast.gets).toBe(2);
  });
});
