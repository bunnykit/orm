import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class BUser extends Model {
  static table = "b_users";
  roles() {
    return this.belongsToMany(BRole);
  }
}

class BRole extends Model {
  static table = "b_roles";
  users() {
    return this.belongsToMany(BUser);
  }
}

describe("BelongsToMany", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("b_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("b_roles", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("b_role_b_user", (table) => {
      table.increments("id");
      table.integer("b_user_id");
      table.integer("b_role_id");
      table.timestamps();
    });
  });

  test("attach adds pivot rows", async () => {
    const user = await BUser.create({ name: "Alice" });
    const role = await BRole.create({ title: "Admin" });

    await user.roles().attach(role.getAttribute("id"));

    const roles = await user.roles().getResults();
    expect(roles).toHaveLength(1);
    expect(roles[0].getAttribute("title")).toBe("Admin");
  });

  test("detach removes pivot rows", async () => {
    const user = await BUser.create({ name: "Bob" });
    const role1 = await BRole.create({ title: "Editor" });
    const role2 = await BRole.create({ title: "Viewer" });

    await user.roles().attach([role1.getAttribute("id"), role2.getAttribute("id")]);
    await user.roles().detach(role1.getAttribute("id"));

    const roles = await user.roles().getResults();
    expect(roles).toHaveLength(1);
    expect(roles[0].getAttribute("title")).toBe("Viewer");
  });

  test("sync keeps only given ids", async () => {
    const user = await BUser.create({ name: "Carl" });
    const role1 = await BRole.create({ title: "A" });
    const role2 = await BRole.create({ title: "B" });
    const role3 = await BRole.create({ title: "C" });

    await user.roles().attach([role1.getAttribute("id"), role2.getAttribute("id")]);
    await user.roles().sync([role2.getAttribute("id"), role3.getAttribute("id")]);

    const roles = await user.roles().getResults();
    expect(roles).toHaveLength(2);
    const titles = roles.map((r) => r.getAttribute("title"));
    expect(titles).toContain("B");
    expect(titles).toContain("C");
  });

  test("eager loading belongsToMany", async () => {
    const user = await BUser.create({ name: "Dana" });
    const role = await BRole.create({ title: "Manager" });
    await user.roles().attach(role.getAttribute("id"));

    const users = await BUser.with("roles").where("id", user.getAttribute("id")).get();
    expect(users[0].getRelation("roles")).toHaveLength(1);
    expect(users[0].getRelation("roles")[0].getAttribute("title")).toBe("Manager");
  });
});
