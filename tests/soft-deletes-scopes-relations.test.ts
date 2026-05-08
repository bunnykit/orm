import { beforeAll, describe, expect, test } from "bun:test";
import { Model, Schema } from "../src/index.js";
import type { Builder } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class ScopedUser extends Model {
  static table = "scoped_users";
  static softDeletes = true;

  static scopeActive(query: Builder<any>) {
    return query.where("active", true);
  }

  posts() {
    return this.hasMany(ScopedPost);
  }
}

class ScopedPost extends Model {
  static table = "scoped_posts";
  static softDeletes = true;

  user() {
    return this.belongsTo(ScopedUser);
  }
}

class ScopedRole extends Model {
  static table = "scoped_roles";

  users() {
    return this.belongsToMany(ScopedUser, "scoped_role_user", "scoped_role_id", "scoped_user_id");
  }
}

class TenantItem extends Model {
  static table = "tenant_items";
}

describe("Soft Deletes, Scopes, and Relation Queries", () => {
  beforeAll(async () => {
    setupTestDb();

    TenantItem.addGlobalScope("tenant", (query) => {
      query.where("tenant_id", 1);
    });

    await Schema.create("scoped_users", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active").default(true);
      table.timestamps();
      table.softDeletes();
    });
    await Schema.create("scoped_posts", (table) => {
      table.increments("id");
      table.integer("scoped_user_id");
      table.string("title");
      table.integer("views").default(0);
      table.timestamps();
      table.softDeletes();
    });
    await Schema.create("scoped_roles", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("scoped_role_user", (table) => {
      table.increments("id");
      table.integer("scoped_user_id");
      table.integer("scoped_role_id");
      table.timestamps();
    });
    await Schema.create("tenant_items", (table) => {
      table.increments("id");
      table.integer("tenant_id");
      table.string("name");
      table.timestamps();
    });
  });

  test("soft deletes hide rows by default and can be included or restored", async () => {
    const user = await ScopedUser.create({ name: "Archived", active: true });

    await user.delete();

    expect(await ScopedUser.find(user.getAttribute("id"))).toBeNull();
    expect(await ScopedUser.withTrashed().find(user.getAttribute("id"))).not.toBeNull();
    expect(await ScopedUser.onlyTrashed().count()).toBe(1);

    await user.restore();

    expect(await ScopedUser.find(user.getAttribute("id"))).not.toBeNull();
    expect(await ScopedUser.onlyTrashed().count()).toBe(0);

    await user.forceDelete();
    expect(await ScopedUser.withTrashed().find(user.getAttribute("id"))).toBeNull();
  });

  test("local and global scopes constrain queries", async () => {
    await ScopedUser.create({ name: "Active", active: true });
    await ScopedUser.create({ name: "Inactive", active: false });
    await TenantItem.create({ tenant_id: 1, name: "Visible" });
    await TenantItem.create({ tenant_id: 2, name: "Hidden" });

    const activeUsers = await ScopedUser.scope("active").get();
    expect(activeUsers.every((user) => user.getAttribute("active"))).toBe(true);

    const tenantItems = await TenantItem.all();
    expect(tenantItems).toHaveLength(1);
    expect(tenantItems[0].getAttribute("name")).toBe("Visible");

    const allTenantItems = await TenantItem.withoutGlobalScope("tenant").get();
    expect(allTenantItems).toHaveLength(2);
  });

  test("has, whereHas, doesntHave, and aggregates query related rows", async () => {
    const ada = await ScopedUser.create({ name: "Ada", active: true });
    const linus = await ScopedUser.create({ name: "Linus", active: true });
    const grace = await ScopedUser.create({ name: "Grace", active: true });

    await ScopedPost.create({ scoped_user_id: ada.getAttribute("id"), title: "Intro", views: 10 });
    await ScopedPost.create({ scoped_user_id: ada.getAttribute("id"), title: "Deep Dive", views: 30 });
    const hiddenPost = await ScopedPost.create({ scoped_user_id: linus.getAttribute("id"), title: "Draft", views: 99 });
    await hiddenPost.delete();

    const usersWithPosts = await ScopedUser.has("posts").get();
    expect(usersWithPosts.map((user) => user.getAttribute("name"))).toContain("Ada");
    expect(usersWithPosts.map((user) => user.getAttribute("name"))).not.toContain("Linus");

    const deepDiveUsers = await ScopedUser.whereHas("posts", (query) => {
      query.where("title", "Deep Dive");
    }).get();
    expect(deepDiveUsers).toHaveLength(1);
    expect(deepDiveUsers[0].getAttribute("name")).toBe("Ada");

    const usersWithoutPosts = await ScopedUser.doesntHave("posts").get();
    const namesWithoutPosts = usersWithoutPosts.map((user) => user.getAttribute("name"));
    expect(namesWithoutPosts).toContain("Linus");
    expect(namesWithoutPosts).toContain("Grace");

    const usersWithCounts = await ScopedUser.withCount("posts").withSum("posts", "views").where("id", ada.getAttribute("id")).get();
    expect(usersWithCounts[0].getAttribute("posts_count")).toBe(2);
    expect(usersWithCounts[0].getAttribute("posts_sum_views")).toBe(40);
  });

  test("whereHas works for belongsToMany relations", async () => {
    const user = await ScopedUser.create({ name: "Role User", active: true });
    const role = await ScopedRole.create({ title: "Maintainer" });
    await role.users().attach(user.getAttribute("id"));

    const roles = await ScopedRole.whereHas("users", (query) => {
      query.where("name", "Role User");
    }).get();

    expect(roles).toHaveLength(1);
    expect(roles[0].getAttribute("title")).toBe("Maintainer");
  });
});
