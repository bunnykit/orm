import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, IdentityMap } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class User extends Model {
  static table = "users";
  static fillable = ["name"];
}

describe("Identity Map", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
  });

  test("find returns same instance within identity map context", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Alice" });
      const found = await User.find(user.id);

      expect(found).toBe(user); // Same object reference
    });
  });

  test("find returns different instances outside identity map context", async () => {
    const user = await User.create({ name: "Bob" });
    const found1 = await User.find(user.id);
    const found2 = await User.find(user.id);

    expect(found1).not.toBe(found2); // Different object references
    expect(found1!.id).toBe(found2!.id);
  });

  test("multiple queries return cached instances", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Charlie" });

      const a = await User.find(user.id);
      const b = await User.query().where("id", user.id).first();
      const c = await User.query().where("name", "Charlie").first();

      expect(a).toBe(user);
      expect(b).toBe(user);
      expect(c).toBe(user);
    });
  });

  test("created models are registered in identity map", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Dave" });
      const cached = IdentityMap.get("users", user.id);

      expect(cached).toBe(user);
    });
  });

  test("saved models are registered in identity map", async () => {
    await IdentityMap.run(async () => {
      const user = new User({ name: "Eve" });
      await user.save();
      const cached = IdentityMap.get("users", user.id);

      expect(cached).toBe(user);
    });
  });

  test("identity map does not leak across contexts", async () => {
    let userId: number;

    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Frank" });
      userId = user.id;
    });

    // Outside the context, identity map is empty
    const cached = IdentityMap.get("users", userId!);
    expect(cached).toBeUndefined();

    const found = await User.find(userId!);
    expect(found).toBeDefined();
  });

  test("identity map survives within same async context", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Grace" });

      // Simulate multiple operations in same request
      const found1 = await User.find(user.id);
      const found2 = await User.find(user.id);
      const found3 = await User.find(user.id);

      expect(found1).toBe(user);
      expect(found2).toBe(user);
      expect(found3).toBe(user);
    });
  });

  test("bulk get() registers all rows in identity map", async () => {
    await IdentityMap.run(async () => {
      const hank = await User.create({ name: "Hank" });
      const ivy = await User.create({ name: "Ivy" });

      const users = await User.query().whereIn("id", [hank.id, ivy.id]).get();
      expect(users).toHaveLength(2);

      for (const user of users) {
        const cached = IdentityMap.get("users", user.id);
        expect(cached).toBe(user);
      }
    });
  });

  test("mutations on cached instance are visible to subsequent finds", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Jack" });

      user.name = "Jackson";

      const found = await User.find(user.id);
      expect(found!.name).toBe("Jackson");
    });
  });
});
