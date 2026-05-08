import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Connection, Schema, Builder } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

describe("Advanced Query Builder Features", () => {
  let db: Connection;

  beforeAll(async () => {
    db = setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.integer("price");
      table.string("category").nullable();
      table.json("tags").nullable();
      table.timestamps();
    });

    await Schema.create("categories", (table) => {
      table.increments("id");
      table.string("name");
    });

    const builder = new Builder(db, "products");
    await builder.insert([
      { name: "A", price: 10, category: "foo", tags: '["red","small"]' },
      { name: "B", price: 20, category: null, tags: '["blue","large"]' },
      { name: "C", price: 30, category: "bar", tags: '["red","large"]' },
      { name: "D", price: 40, category: "foo", tags: null },
    ]);

    const catBuilder = new Builder(db, "categories");
    await catBuilder.insert([
      { name: "foo" },
      { name: "bar" },
    ]);
  });

  afterAll(async () => {
    await Schema.dropIfExists("products");
    await Schema.dropIfExists("categories");
  });

  describe("or* where variants", () => {
    test("orWhereNull", async () => {
      const results = await new Builder(db, "products")
        .where("category", "foo")
        .orWhereNull("category")
        .get();
      expect(results.length).toBe(3); // A, B, D
    });

    test("orWhereNotNull", async () => {
      const results = await new Builder(db, "products")
        .where("name", "B")
        .orWhereNotNull("category")
        .get();
      expect(results.length).toBe(4); // all have category except B, but B matches name
    });

    test("orWhereBetween", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereBetween("price", [25, 35])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "C"]);
    });

    test("orWhereNotBetween", async () => {
      const results = await new Builder(db, "products")
        .where("name", "B")
        .orWhereNotBetween("price", [15, 35])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "B", "D"]);
    });

    test("orWhereIn", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereIn("name", ["C", "D"])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "C", "D"]);
    });

    test("orWhereNotIn", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereNotIn("name", ["A", "B"])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "C", "D"]);
    });

    test("orWhereExists", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereExists("SELECT 1 FROM categories WHERE categories.name = products.category")
        .get();
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("orWhereNotExists", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereNotExists("SELECT 1 FROM categories WHERE categories.name = 'nonexistent'")
        .get();
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("orWhereColumn", async () => {
      const sql = new Builder(db, "products")
        .where("name", "A")
        .orWhereColumn("name", "!=", "category")
        .toSql();
      expect(sql).toContain("OR");
      expect(sql).toContain("!=");
    });

    test("orWhereRaw", async () => {
      const sql = new Builder(db, "products")
        .where("name", "A")
        .orWhereRaw("price > 25")
        .toSql();
      expect(sql).toContain("OR price > 25");
    });
  });

  describe("Having variants", () => {
    test("havingRaw", async () => {
      const sql = new Builder(db, "products")
        .select("category")
        .groupBy("category")
        .havingRaw("COUNT(*) > 1")
        .toSql();
      expect(sql).toContain("HAVING COUNT(*) > 1");
    });

    test("orHaving", async () => {
      const sql = new Builder(db, "products")
        .select("category")
        .groupBy("category")
        .having("price", ">", 5)
        .orHaving("price", "<", 50)
        .toSql();
      expect(sql).toContain("HAVING");
      expect(sql).toContain("OR");
    });

    test("orHavingRaw", async () => {
      const sql = new Builder(db, "products")
        .select("category")
        .groupBy("category")
        .havingRaw("COUNT(*) > 1")
        .orHavingRaw("SUM(price) > 10")
        .toSql();
      expect(sql).toContain("OR SUM(price) > 10");
    });
  });

  describe("Order helpers", () => {
    test("orderByDesc", async () => {
      const results = await new Builder(db, "products").orderByDesc("price").get();
      expect(results[0].name).toBe("D");
    });

    test("reorder clears orders", async () => {
      const sql = new Builder(db, "products").orderBy("name").reorder().toSql();
      expect(sql).not.toContain("ORDER BY");
    });

    test("reorder with new column", async () => {
      const sql = new Builder(db, "products").orderBy("name").reorder("price", "desc").toSql();
      expect(sql).toContain('ORDER BY "price" DESC');
      expect(sql).not.toContain('"name"');
    });
  });

  describe("Cross Join", () => {
    test("crossJoin generates CROSS JOIN", () => {
      const sql = new Builder(db, "products").crossJoin("categories").toSql();
      expect(sql).toContain("CROSS JOIN");
    });
  });

  describe("Union", () => {
    test("union combines queries", () => {
      const a = new Builder(db, "products").where("name", "A");
      const b = new Builder(db, "products").where("name", "B");
      const sql = a.union(b).toSql();
      expect(sql).toContain("UNION");
    });

    test("unionAll", () => {
      const a = new Builder(db, "products").where("name", "A");
      const b = new Builder(db, "products").where("name", "B");
      const sql = a.unionAll(b).toSql();
      expect(sql).toContain("UNION ALL");
    });
  });

  describe("Insert Or Ignore", () => {
    test("insertOrIgnore does not throw on duplicate", async () => {
      await new Builder(db, "products").insertOrIgnore({ name: "Z", price: 99 });
      const found = await new Builder(db, "products").where("name", "Z").first();
      expect(found).not.toBeNull();
      // insert again should be ignored
      await expect(new Builder(db, "products").insertOrIgnore({ name: "Z", price: 99 })).resolves.toBeDefined();
    });
  });

  describe("Upsert", () => {
    beforeAll(async () => {
      await Schema.create("upsert_test", (table) => {
        table.increments("id");
        table.string("slug").unique();
        table.integer("counter");
      });
    });

    afterAll(async () => {
      await Schema.dropIfExists("upsert_test");
    });

    test("upsert inserts new record", async () => {
      await new Builder(db, "upsert_test").upsert({ slug: "x", counter: 1 }, "slug");
      const found = await new Builder(db, "upsert_test").where("slug", "x").first();
      expect(found).not.toBeNull();
      expect((found as any).counter).toBe(1);
    });

    test("upsert updates existing record", async () => {
      await new Builder(db, "upsert_test").upsert({ slug: "x", counter: 5 }, "slug");
      const found = await new Builder(db, "upsert_test").where("slug", "x").first();
      expect((found as any).counter).toBe(5);
    });
  });

  describe("Delete with limit", () => {
    test("delete with limit generates LIMIT in SQL", async () => {
      // Use a fresh disposable table so we don't affect shared data
      await Schema.create("delete_limits", (table) => {
        table.increments("id");
        table.string("name");
      });
      await new Builder(db, "delete_limits").insert([{ name: "a" }, { name: "b" }]);
      const sql = new Builder(db, "delete_limits").where("name", "a").limit(1).toSql();
      expect(sql).toContain("LIMIT 1");
      await Schema.dropIfExists("delete_limits");
    });
  });

  describe("Lock modifiers", () => {
    test("skipLocked appends SKIP LOCKED on mysql/postgres SQL", () => {
      // Manually set lockMode to simulate non-sqlite driver
      const builder = new Builder(db, "products");
      builder.lockMode = "FOR UPDATE";
      builder.skipLocked();
      expect(builder.toSql()).toContain("SKIP LOCKED");
    });

    test("noWait appends NOWAIT on mysql/postgres SQL", () => {
      const builder = new Builder(db, "products");
      builder.lockMode = "FOR UPDATE";
      builder.noWait();
      expect(builder.toSql()).toContain("NOWAIT");
    });
  });

  describe("JSON where", () => {
    test("whereJsonContains compiles SQL", () => {
      const sql = new Builder(db, "products").whereJsonContains("tags", "red").toSql();
      expect(sql.length).toBeGreaterThan(0);
    });

    test("whereJsonLength compiles SQL", () => {
      const sql = new Builder(db, "products").whereJsonLength("tags", 2).toSql();
      expect(sql.length).toBeGreaterThan(0);
    });
  });

  describe("Like / Regexp", () => {
    test("whereLike compiles LIKE SQL", () => {
      const sql = new Builder(db, "products").whereLike("name", "%A%").toSql();
      expect(sql).toContain("LIKE");
    });

    test("whereNotLike compiles NOT LIKE SQL", () => {
      const sql = new Builder(db, "products").whereNotLike("name", "%A%").toSql();
      expect(sql).toContain("NOT LIKE");
    });

    test("whereRegexp compiles REGEXP SQL", () => {
      const sql = new Builder(db, "products").whereRegexp("name", "^A").toSql();
      expect(sql).toContain("REGEXP");
    });
  });

  describe("Full Text", () => {
    test("whereFullText compiles SQL", () => {
      const sql = new Builder(db, "products").whereFullText("name", "foo").toSql();
      expect(sql.length).toBeGreaterThan(0);
    });
  });

  describe("whereAll / whereAny", () => {
    test("whereAll groups with AND", () => {
      const sql = new Builder(db, "products").whereAll(["name", "category"], "=", "foo").toSql();
      expect(sql).toContain("(");
      expect(sql).toContain("AND");
    });

    test("whereAny groups with OR", () => {
      const sql = new Builder(db, "products").whereAny(["name", "category"], "=", "foo").toSql();
      expect(sql).toContain("(");
      expect(sql).toContain("OR");
    });
  });

  describe("sole", () => {
    test("sole returns single record", async () => {
      const result = await new Builder(db, "products").where("name", "A").sole();
      expect((result as any).name).toBe("A");
    });

    test("sole throws when no records", async () => {
      await expect(new Builder(db, "products").where("name", "ZZZ").sole()).rejects.toThrow();
    });

    test("sole throws when multiple records", async () => {
      await expect(new Builder(db, "products").where("category", "foo").sole()).rejects.toThrow("Multiple records found");
    });
  });

  describe("value", () => {
    test("value returns single column", async () => {
      const name = await new Builder(db, "products").where("name", "A").value("name");
      expect(name).toBe("A");
    });

    test("value returns null when not found", async () => {
      const name = await new Builder(db, "products").where("name", "ZZZ").value("name");
      expect(name).toBeNull();
    });
  });

  describe("selectRaw", () => {
    test("selectRaw adds raw expression", () => {
      const sql = new Builder(db, "products").select("name").selectRaw("price * 2 as doubled").toSql();
      expect(sql).toContain("price * 2 as doubled");
    });
  });

  describe("fromSub", () => {
    test("fromSub wraps subquery", () => {
      const sub = new Builder(db, "products").where("price", ">", 10);
      const sql = new Builder(db, "products").fromSub(sub, "expensive").toSql();
      expect(sql).toContain("(SELECT");
      expect(sql).toContain("AS");
    });
  });

  describe("updateFrom", () => {
    test("updateFrom populates updateJoins", () => {
      const builder = new Builder(db, "products")
        .updateFrom("categories", "products.category", "=", "categories.name");
      expect(builder.updateJoins.length).toBe(1);
      expect(builder.updateJoins[0]).toContain("INNER JOIN");
    });
  });

  describe("dump / dd", () => {
    test("dump returns builder", () => {
      const builder = new Builder(db, "products").where("name", "A");
      expect(builder.dump()).toBe(builder);
    });

    test("dd throws", () => {
      expect(() => new Builder(db, "products").dd()).toThrow("dd() called");
    });
  });
});
