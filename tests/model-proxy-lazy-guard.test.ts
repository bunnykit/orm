import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class Product extends Model {
  static table = "products";
  static fillable = ["name", "price"];
}

class Review extends Model {
  static table = "reviews";
  static fillable = ["product_id", "rating", "comment"];

  product() {
    return this.belongsTo(Product);
  }
}

describe("Model Attribute Access", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.decimal("price");
      table.timestamps();
    });
    await Schema.create("reviews", (table) => {
      table.increments("id");
      table.integer("product_id");
      table.integer("rating");
      table.text("comment");
      table.timestamps();
    });
  });

  test("direct property assignment works for unknown attributes", async () => {
    const product = new Product();
    product.name = "Widget";
    product.price = 19.99;
    await product.save();

    expect(product.getAttribute("name")).toBe("Widget");
    expect(product.getAttribute("price")).toBe(19.99);
  });

  test("property getters return attribute values", async () => {
    const product = await Product.create({ name: "Gadget", price: 29.99 });
    expect(product.name).toBe("Gadget");
    expect(product.price).toBe(29.99);
  });

  test("Object.keys includes attribute names", async () => {
    const product = await Product.create({ name: "Thing", price: 9.99 });
    const keys = Object.keys(product);
    expect(keys).toContain("name");
    expect(keys).toContain("price");
  });

  test("in operator works for attributes", async () => {
    const product = await Product.create({ name: "Item", price: 5 });
    expect("name" in product).toBe(true);
    expect("nonexistent" in product).toBe(false);
  });

  test("Object.getOwnPropertyDescriptor returns descriptor for attributes", async () => {
    const product = await Product.create({ name: "Desc", price: 1 });
    const desc = Object.getOwnPropertyDescriptor(product, "name");
    expect(desc).toBeDefined();
    expect(desc!.enumerable).toBe(true);
    expect(desc!.configurable).toBe(true);
  });
});

describe("Lazy Loading Prevention", () => {
  test("throws when preventLazyLoading is enabled", async () => {
    const product = await Product.create({ name: "Parent", price: 10 });
    await Review.create({ product_id: product.id, rating: 5, comment: "Great" });

    Model.preventLazyLoading = true;
    try {
      const review = await Review.find(1);
      expect(() => review!.product().getResults()).toThrow("Lazy loading is prevented");
    } finally {
      Model.preventLazyLoading = false;
    }
  });

  test("does not throw when preventLazyLoading is disabled", async () => {
    const product = await Product.create({ name: "Parent2", price: 20 });
    await Review.create({ product_id: product.id, rating: 4, comment: "Good" });

    Model.preventLazyLoading = false;
    const review = await Review.find(1);
    const related = await review!.product().getResults();
    expect(related).not.toBeNull();
  });
});
