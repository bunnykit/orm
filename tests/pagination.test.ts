import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class PUser extends Model {
  static table = "p_users";
}

describe("Pagination", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("p_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });

    for (let i = 1; i <= 25; i++) {
      await PUser.create({ name: `User ${i}` });
    }
  });

  test("paginate returns correct structure", async () => {
    const result = await PUser.paginate(10, 1);
    expect(result.data).toHaveLength(10);
    expect(result.current_page).toBe(1);
    expect(result.per_page).toBe(10);
    expect(result.total).toBe(25);
    expect(result.last_page).toBe(3);
    expect(result.from).toBe(1);
    expect(result.to).toBe(10);
  });

  test("paginate page 2", async () => {
    const result = await PUser.paginate(10, 2);
    expect(result.data).toHaveLength(10);
    expect(result.current_page).toBe(2);
    expect(result.from).toBe(11);
    expect(result.to).toBe(20);
  });

  test("paginate last page", async () => {
    const result = await PUser.paginate(10, 3);
    expect(result.data).toHaveLength(5);
    expect(result.from).toBe(21);
    expect(result.to).toBe(25);
  });

  test("paginate with where clause", async () => {
    const result = await PUser.where("name", "like", "User 1%").paginate(5, 1);
    // User 1, User 10-19 = 11 matches
    expect(result.total).toBe(11);
    expect(result.data.length).toBeLessThanOrEqual(5);
  });

  test("paginate total ignores existing limit and offset", async () => {
    const result = await PUser.query().limit(2).offset(10).paginate(5, 1);
    expect(result.total).toBe(25);
    expect(result.data).toHaveLength(5);
    expect(result.last_page).toBe(5);
  });

  test("paginate empty result", async () => {
    const result = await PUser.where("name", "NonExistent").paginate(10, 1);
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });
});
