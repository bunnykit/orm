import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class Product extends Model {
  static table = "products";
}

describe("Doesnt Exist", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Product.create({ name: "Widget" });
  });

  test("doesntExist returns false when rows exist", async () => {
    const result = await Product.where("name", "Widget").doesntExist();
    expect(result).toBe(false);
  });

  test("doesntExist returns true when no rows match", async () => {
    const result = await Product.where("name", "NonExistent").doesntExist();
    expect(result).toBe(true);
  });
});

describe("Take / Skip", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });

    for (let i = 1; i <= 5; i++) {
      await Product.create({ name: `Product ${i}` });
    }
  });

  test("take limits results", async () => {
    const products = await Product.take(2).get();
    expect(products.length).toBe(2);
  });

  test("skip offsets results", async () => {
    const products = await Product.orderBy("id").skip(2).get();
    expect(products.length).toBe(3);
    expect(products[0].name).toBe("Product 3");
  });

  test("take and skip combined", async () => {
    const products = await Product.orderBy("id").skip(1).take(2).get();
    expect(products.length).toBe(2);
    expect(products[0].name).toBe("Product 2");
    expect(products[1].name).toBe("Product 3");
  });
});

describe("Row Locking", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
  });

  test("lockForUpdate appends FOR UPDATE on sqlite (noop)", async () => {
    const sql = Product.where("id", 1).lockForUpdate().toSql();
    expect(sql).not.toContain("FOR UPDATE");
  });

  test("sharedLock appends lock clause on sqlite (noop)", async () => {
    const sql = Product.where("id", 1).sharedLock().toSql();
    expect(sql).not.toContain("LOCK IN SHARE MODE");
    expect(sql).not.toContain("FOR SHARE");
  });
});

describe("Random Order", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });

    for (let i = 1; i <= 5; i++) {
      await Product.create({ name: `Product ${i}` });
    }
  });

  test("inRandomOrder generates RANDOM() for sqlite", async () => {
    const sql = Product.inRandomOrder().toSql();
    expect(sql).toContain("ORDER BY RANDOM()");
  });

  test("inRandomOrder returns all results in random order", async () => {
    const products = await Product.inRandomOrder().get();
    expect(products.length).toBe(5);
  });
});

describe("Nested Where Groups", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.string("category");
      table.integer("price");
      table.timestamps();
    });

    await Product.create({ name: "A", category: "electronics", price: 100 });
    await Product.create({ name: "B", category: "electronics", price: 200 });
    await Product.create({ name: "C", category: "clothing", price: 50 });
    await Product.create({ name: "D", category: "clothing", price: 150 });
  });

  test("where with closure groups conditions", async () => {
    const products = await Product
      .where("category", "electronics")
      .where((q) => q.where("price", "<", 150).orWhere("name", "B"))
      .get();

    expect(products.length).toBe(2);
    const names = products.map((p: any) => p.name).sort();
    expect(names).toEqual(["A", "B"]);
  });

  test("orWhere with closure groups OR conditions", async () => {
    const products = await Product
      .where("category", "clothing")
      .orWhere((q) => q.where("price", ">=", 200).where("category", "electronics"))
      .get();

    expect(products.length).toBe(3);
    const names = products.map((p: any) => p.name).sort();
    expect(names).toEqual(["B", "C", "D"]);
  });

  test("nested where generates correct SQL", async () => {
    const sql = Product
      .where("category", "electronics")
      .where((q) => q.where("price", "<", 150).orWhere("name", "B"))
      .toSql();

    expect(sql).toContain('("price" < 150 OR "name" = \'B\')');
  });

  test("multiple nested groups", async () => {
    const products = await Product
      .where((q) => q.where("category", "electronics").where("price", 100))
      .orWhere((q) => q.where("category", "clothing").where("price", 50))
      .get();

    expect(products.length).toBe(2);
    const names = products.map((p: any) => p.name).sort();
    expect(names).toEqual(["A", "C"]);
  });
});
