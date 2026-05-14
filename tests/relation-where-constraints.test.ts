import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema, MorphMap } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

// ─── Models ──────────────────────────────────────────────────────────────────

class RwcUser extends Model {
  static table = "rwc_users";

  publishedPosts() {
    return this.hasMany(RwcPost).where("status", "published");
  }

  activeProfile() {
    return this.hasOne(RwcProfile).where("active", 1);
  }

  adminRoles() {
    return this.belongsToMany(RwcRole, "rwc_role_user", "rwc_user_id", "rwc_role_id")
      .where("rwc_roles.level", ">", 5);
  }

  featuredRoles() {
    return this.belongsToMany(RwcRole, "rwc_role_user", "rwc_user_id", "rwc_role_id")
      .withPivot("scope")
      .wherePivot("scope", "featured");
  }

  profilePicture() {
    return this.morphOne(RwcAttachment, "attachable").where("collection", "avatar");
  }

  publicAttachments() {
    return this.morphMany(RwcAttachment, "attachable").where("visibility", "public");
  }
}

class RwcPost extends Model {
  static table = "rwc_posts";

  author() {
    return this.belongsTo(RwcUser).where("rwc_users.active", 1);
  }

  featuredTags() {
    return this.morphToMany(RwcTag, "taggable", "rwc_taggables")
      .withPivot("kind")
      .wherePivot("kind", "featured");
  }
}

class RwcProfile extends Model {
  static table = "rwc_profiles";
}

class RwcRole extends Model {
  static table = "rwc_roles";
}

class RwcTag extends Model {
  static table = "rwc_tags";
}

class RwcAttachment extends Model {
  static table = "rwc_attachments";
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  setupTestDb();
  MorphMap.register("RwcUser", RwcUser);

  await Schema.create("rwc_users", (table) => {
    table.increments("id");
    table.string("name");
    table.integer("active").default(1);
    table.timestamps();
  });
  await Schema.create("rwc_posts", (table) => {
    table.increments("id");
    table.integer("rwc_user_id");
    table.string("title");
    table.string("status").default("draft");
    table.timestamps();
  });
  await Schema.create("rwc_profiles", (table) => {
    table.increments("id");
    table.integer("rwc_user_id");
    table.string("bio").nullable();
    table.integer("active").default(1);
    table.timestamps();
  });
  await Schema.create("rwc_roles", (table) => {
    table.increments("id");
    table.string("name");
    table.integer("level").default(1);
    table.timestamps();
  });
  await Schema.create("rwc_role_user", (table) => {
    table.increments("id");
    table.integer("rwc_user_id");
    table.integer("rwc_role_id");
    table.string("scope").nullable();
    table.timestamps();
  });
  await Schema.create("rwc_tags", (table) => {
    table.increments("id");
    table.string("name");
    table.timestamps();
  });
  await Schema.create("rwc_taggables", (table) => {
    table.increments("id");
    table.integer("taggable_id");
    table.string("taggable_type");
    table.integer("rwc_tag_id");
    table.string("kind").nullable();
    table.timestamps();
  });
  await Schema.create("rwc_attachments", (table) => {
    table.increments("id");
    table.integer("attachable_id");
    table.string("attachable_type");
    table.string("collection").default("default");
    table.string("visibility").default("private");
    table.timestamps();
  });

  // Seed
  const u1 = await RwcUser.create({ name: "Alice", active: 1 });
  const u2 = await RwcUser.create({ name: "Bob", active: 0 });

  await RwcPost.create({ rwc_user_id: u1.id, title: "Published A", status: "published" });
  await RwcPost.create({ rwc_user_id: u1.id, title: "Draft A", status: "draft" });
  await RwcPost.create({ rwc_user_id: u2.id, title: "Published B", status: "published" });

  await RwcProfile.create({ rwc_user_id: u1.id, bio: "active profile", active: 1 });
  await RwcProfile.create({ rwc_user_id: u1.id, bio: "inactive profile", active: 0 });

  const roleAdmin = await RwcRole.create({ name: "admin", level: 10 });
  const roleUser = await RwcRole.create({ name: "user", level: 2 });
  const db = (RwcUser as any).query().connection;
  await db.run(
    "INSERT INTO rwc_role_user (rwc_user_id, rwc_role_id) VALUES (?, ?), (?, ?)",
    [u1.id, roleAdmin.id, u1.id, roleUser.id]
  );

  const featuredTag = await RwcTag.create({ name: "featured" });
  await db.run(
    "INSERT INTO rwc_taggables (taggable_id, taggable_type, rwc_tag_id, kind) VALUES (?, ?, ?, ?)",
    [1, "RwcPost", featuredTag.id, "featured"]
  );

  await RwcAttachment.create({ attachable_id: u1.id, attachable_type: "RwcUser", collection: "avatar", visibility: "public" });
  await RwcAttachment.create({ attachable_id: u1.id, attachable_type: "RwcUser", collection: "banner", visibility: "public" });
  await RwcAttachment.create({ attachable_id: u1.id, attachable_type: "RwcUser", collection: "avatar", visibility: "private" });
});

// ─── hasMany ──────────────────────────────────────────────────────────────────

describe("hasMany + where()", () => {
  test("lazy load returns only matching rows", async () => {
    const user = await RwcUser.find(1) as RwcUser;
    const posts = await user.publishedPosts().get() as Collection<RwcPost>;
    expect(posts.count()).toBe(1);
    expect((posts.first() as any).title).toBe("Published A");
  });

  test("create() applies the relation where() constraint", async () => {
    const user = await RwcUser.find(1) as RwcUser;
    const post = await user.publishedPosts().create({ title: "Created through relation", status: "draft" });
    expect((post as any).status).toBe("published");

    const loaded = await user.publishedPosts().get() as Collection<RwcPost>;
    expect(loaded.some((item: any) => item.title === "Created through relation")).toBe(true);
  });

  test("createMany() applies the relation where() constraint", async () => {
    const user = await RwcUser.find(1) as RwcUser;
    const posts = await user.publishedPosts().createMany([
      { title: "Batch A" },
      { title: "Batch B" },
    ]);

    expect(posts.every((post: any) => post.status === "published")).toBe(true);
  });

  test("eager load applies constraint across batch", async () => {
    const users = await RwcUser.with("publishedPosts").get();
    const alice = users.find((u: any) => u.name === "Alice") as any;
    const bob = users.find((u: any) => u.name === "Bob") as any;
    expect(alice.publishedPosts.some((post: any) => post.title === "Published A")).toBe(true);
    expect(bob.publishedPosts.some((post: any) => post.title === "Published B")).toBe(true);
    for (const post of alice.publishedPosts) {
      expect((post as any).status).toBe("published");
    }
    for (const post of bob.publishedPosts) {
      expect((post as any).status).toBe("published");
    }
  });

  test("toSql includes where constraint", () => {
    const user = new RwcUser();
    (user as any).$attributes = { id: 1 };
    const sql = user.publishedPosts().getQuery().toSql();
    expect(sql).toContain("status");
    expect(sql).toContain("published");
  });
});

// ─── hasOne ───────────────────────────────────────────────────────────────────

describe("hasOne + where()", () => {
  test("lazy load returns only matching row", async () => {
    const user = await RwcUser.find(1) as any;
    const profile = await user.activeProfile().get();
    expect(profile).not.toBeNull();
    expect((profile as any).bio).toBe("active profile");
  });

  test("eager load applies constraint", async () => {
    const users = await RwcUser.with("activeProfile").get();
    const alice = users.find((u: any) => u.name === "Alice") as any;
    expect(alice.activeProfile).not.toBeNull();
    expect(alice.activeProfile.bio).toBe("active profile");
  });

  test("toSql includes where constraint", () => {
    const user = new RwcUser();
    (user as any).$attributes = { id: 1 };
    const sql = user.activeProfile().getQuery().toSql();
    expect(sql).toContain("active");
  });
});

// ─── belongsTo ────────────────────────────────────────────────────────────────

describe("belongsTo + where()", () => {
  test("toSql includes where constraint", async () => {
    const post = await RwcPost.find(1) as any;
    const sql = post.author().getQuery().toSql();
    expect(sql).toContain("active");
  });

  test("eager load applies constraint", async () => {
    const posts = await RwcPost.with("author").get();
    for (const post of posts) {
      const author = (post as any).author;
      if (author !== null) {
        expect((author as any).active).toBe(1);
      }
    }
  });
});

// ─── belongsToMany ────────────────────────────────────────────────────────────

describe("belongsToMany + where()", () => {
  test("lazy load returns only high-level roles", async () => {
    const user = await RwcUser.find(1) as any;
    const roles = await user.adminRoles().get() as Collection<RwcRole>;
    expect(roles.count()).toBe(1);
    expect((roles.first() as any).name).toBe("admin");
  });

  test("eager load applies constraint", async () => {
    const users = await RwcUser.with("adminRoles").get();
    const alice = users.find((u: any) => u.name === "Alice") as any;
    expect(alice.adminRoles.count()).toBe(1);
    expect((alice.adminRoles.first() as any).name).toBe("admin");
  });

  test("toSql includes where constraint", () => {
    const user = new RwcUser();
    (user as any).$attributes = { id: 1 };
    const sql = user.adminRoles().getQuery().toSql();
    expect(sql).toContain("level");
  });
});

describe("belongsToMany attach() applies wherePivot()", () => {
  test("attach fills constrained pivot values", async () => {
    const user = await RwcUser.find(1) as RwcUser;
    const role = await RwcRole.create({ name: "featured", level: 9 });

    await user.featuredRoles().attach(role.id, { scope: "manual" });

    const roles = await user.featuredRoles().get() as Collection<RwcRole>;
    expect(roles.some((item: any) => item.name === "featured")).toBe(true);
    expect((roles.find((item: any) => item.name === "featured") as any).pivot.scope).toBe("featured");
  });
});

// ─── morphOne ─────────────────────────────────────────────────────────────────

describe("morphOne + where()", () => {
  test("lazy load returns only avatar collection", async () => {
    const user = await RwcUser.find(1) as any;
    const attachment = await user.profilePicture().get();
    expect(attachment).not.toBeNull();
    expect((attachment as any).collection).toBe("avatar");
  });

  test("eager load applies constraint", async () => {
    const users = await RwcUser.with("profilePicture").get();
    const alice = users.find((u: any) => u.name === "Alice") as any;
    expect(alice.profilePicture).not.toBeNull();
    expect(alice.profilePicture.collection).toBe("avatar");
  });

  test("toSql includes where constraint", () => {
    const user = new RwcUser();
    (user as any).$attributes = { id: 1 };
    const sql = user.profilePicture().getQuery().toSql();
    expect(sql).toContain("collection");
    expect(sql).toContain("avatar");
  });
});

// ─── morphMany ────────────────────────────────────────────────────────────────

describe("morphMany + where()", () => {
  test("lazy load returns only public attachments", async () => {
    const user = await RwcUser.find(1) as any;
    const attachments = await user.publicAttachments().get() as Collection<RwcAttachment>;
    expect(attachments.count()).toBe(2);
    for (const a of attachments) {
      expect((a as any).visibility).toBe("public");
    }
  });

  test("eager load applies constraint", async () => {
    const users = await RwcUser.with("publicAttachments").get();
    const alice = users.find((u: any) => u.name === "Alice") as any;
    expect(alice.publicAttachments.count()).toBe(2);
    for (const a of alice.publicAttachments) {
      expect((a as any).visibility).toBe("public");
    }
  });

  test("toSql includes where constraint", () => {
    const user = new RwcUser();
    (user as any).$attributes = { id: 1 };
    const sql = user.publicAttachments().getQuery().toSql();
    expect(sql).toContain("visibility");
    expect(sql).toContain("public");
  });
});

describe("morphToMany attach() applies wherePivot()", () => {
  test("attach fills constrained pivot values", async () => {
    const post = await RwcPost.find(1) as RwcPost;
    const tag = await RwcTag.create({ name: "announcement" });

    await post.featuredTags().attach(tag.id, { kind: "manual" });

    const tags = await post.featuredTags().get() as Collection<RwcTag>;
    expect(tags.some((item: any) => item.name === "announcement")).toBe(true);
    expect((tags.find((item: any) => item.name === "announcement") as any).pivot.kind).toBe("featured");
  });
});

// ─── operator form ────────────────────────────────────────────────────────────

describe("where() with operator", () => {
  test("3-arg form works on hasMany", async () => {
    const user = await RwcUser.find(1) as any;
    const posts = await user.hasMany(RwcPost).where("id", ">", 0).get() as Collection<RwcPost>;
    expect(posts.count()).toBeGreaterThan(0);
  });
});
