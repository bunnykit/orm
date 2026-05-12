import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

// ─── Models ──────────────────────────────────────────────────────────────────

class Lf3Post extends Model {
  static table = "lf3_posts";
  author() { return this.belongsTo(Lf3User, "lf3_user_id"); }
  authorWithDefault() { return this.belongsTo(Lf3User, "lf3_user_id").withDefault({ name: "Anonymous" }); }
  authorEmptyDefault() { return this.belongsTo(Lf3User, "lf3_user_id").withDefault(); }
  profile() { return this.hasOne(Lf3Profile, "lf3_post_id"); }
  profileWithDefault() { return this.hasOne(Lf3Profile, "lf3_post_id").withDefault({ bio: "No bio" }); }
  comments() { return this.hasMany(Lf3Comment, "lf3_post_id"); }
}

class Lf3User extends Model {
  static table = "lf3_users";
  static touches = ["latestPost"];
  posts() { return this.hasMany(Lf3Post, "lf3_user_id"); }
  latestPost() { return this.hasOne(Lf3Post, "lf3_user_id"); }
}

class Lf3Profile extends Model {
  static table = "lf3_profiles";
}

class Lf3Comment extends Model {
  static table = "lf3_comments";
  post() { return this.belongsTo(Lf3Post, "lf3_post_id"); }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function setup() {
  setupTestDb();
  await Schema.create("lf3_users", (t) => {
    t.increments("id");
    t.string("name");
    t.timestamps();
  });
  await Schema.create("lf3_posts", (t) => {
    t.increments("id");
    t.integer("lf3_user_id").nullable();
    t.string("title");
    t.timestamps();
  });
  await Schema.create("lf3_profiles", (t) => {
    t.increments("id");
    t.integer("lf3_post_id");
    t.string("bio").nullable();
    t.timestamps();
  });
  await Schema.create("lf3_comments", (t) => {
    t.increments("id");
    t.integer("lf3_post_id");
    t.string("body");
    t.string("status").default("pending");
    t.timestamps();
  });
}

// ─── withDefault() on BelongsTo ───────────────────────────────────────────────

describe("BelongsTo withDefault()", () => {
  beforeAll(setup);

  test("returns null when no default set and FK is null", async () => {
    const post = await Lf3Post.create({ title: "No author", lf3_user_id: null });
    const author = await post.author().get();
    expect(author).toBeNull();
  });

  test("returns default model with attributes when FK is null", async () => {
    const post = await Lf3Post.create({ title: "Default author", lf3_user_id: null });
    const author = await post.authorWithDefault().get();
    expect(author).not.toBeNull();
    expect(author!.getAttribute("name")).toBe("Anonymous");
    expect(author!.$exists).toBe(false);
  });

  test("returns empty default model when withDefault() called with no args", async () => {
    const post = await Lf3Post.create({ title: "Empty default", lf3_user_id: null });
    const author = await post.authorEmptyDefault().get();
    expect(author).not.toBeNull();
    expect(author!.$exists).toBe(false);
  });

  test("returns real record when FK resolves", async () => {
    const user = await Lf3User.create({ name: "Alice" });
    const post = await Lf3Post.create({ title: "Real author", lf3_user_id: user.getAttribute("id") });
    const author = await post.authorWithDefault().get();
    expect(author!.getAttribute("name")).toBe("Alice");
    expect(author!.$exists).toBe(true);
  });

  test("eager load uses default for missing relations", async () => {
    const post1 = await Lf3Post.create({ title: "Has author", lf3_user_id: (await Lf3User.create({ name: "Bob" })).getAttribute("id") });
    const post2 = await Lf3Post.create({ title: "No author", lf3_user_id: null });

    const posts = await Lf3Post.with("authorWithDefault")
      .whereIn("id", [post1.getAttribute("id"), post2.getAttribute("id")])
      .get();

    const withAuthor = posts.find((p) => p.getAttribute("title") === "Has author")!;
    const withDefault = posts.find((p) => p.getAttribute("title") === "No author")!;

    expect(withAuthor.getRelation("authorWithDefault").getAttribute("name")).toBe("Bob");
    expect(withDefault.getRelation("authorWithDefault").getAttribute("name")).toBe("Anonymous");
  });
});

// ─── withDefault() on HasOne ──────────────────────────────────────────────────

describe("HasOne withDefault()", () => {
  beforeAll(setup);

  test("returns null when no default and no related record", async () => {
    const post = await Lf3Post.create({ title: "No profile" });
    const profile = await post.profile().get();
    expect(profile).toBeNull();
  });

  test("returns default model when relation is missing", async () => {
    const post = await Lf3Post.create({ title: "Default profile" });
    const profile = await post.profileWithDefault().get();
    expect(profile).not.toBeNull();
    expect(profile!.getAttribute("bio")).toBe("No bio");
    expect(profile!.$exists).toBe(false);
  });

  test("returns real record when relation exists", async () => {
    const post = await Lf3Post.create({ title: "Real profile" });
    await Lf3Profile.create({ lf3_post_id: post.getAttribute("id"), bio: "Real bio" });
    const profile = await post.profileWithDefault().get();
    expect(profile!.getAttribute("bio")).toBe("Real bio");
    expect(profile!.$exists).toBe(true);
  });
});

// ─── whereRelation / orWhereRelation ─────────────────────────────────────────

describe("whereRelation() / orWhereRelation()", () => {
  beforeAll(setup);

  test("whereRelation filters by related column", async () => {
    const user = await Lf3User.create({ name: "Rel User" });
    await Lf3Post.create({ title: "Published", lf3_user_id: user.getAttribute("id") });
    await Lf3Post.create({ title: "Draft", lf3_user_id: user.getAttribute("id") });
    await Lf3Comment.create({ lf3_post_id: (await Lf3Post.where("title", "Published").first())!.getAttribute("id"), body: "Nice", status: "approved" });

    const posts = await Lf3Post.whereRelation("comments", "status", "approved").get();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.getAttribute("title") !== "Draft")).toBe(true);
  });

  test("whereRelation with operator", async () => {
    const post = await Lf3Post.create({ title: "Op Test" });
    await Lf3Comment.create({ lf3_post_id: post.getAttribute("id"), body: "Good", status: "approved" });

    const found = await Lf3Post.whereRelation("comments", "body", "!=", "Bad").get();
    expect(found.some((p) => p.getAttribute("id") === post.getAttribute("id"))).toBe(true);
  });

  test("orWhereRelation adds OR branch", async () => {
    const post = await Lf3Post.create({ title: "Or Test Post" });
    await Lf3Comment.create({ lf3_post_id: post.getAttribute("id"), body: "Or comment", status: "rejected" });

    const results = await Lf3Post
      .whereRelation("comments", "status", "approved")
      .orWhereRelation("comments", "status", "rejected")
      .get();

    expect(results.some((p) => p.getAttribute("id") === post.getAttribute("id"))).toBe(true);
  });
});

// ─── withWhereHas ─────────────────────────────────────────────────────────────

describe("withWhereHas()", () => {
  beforeAll(setup);

  test("filters and eager loads in one call", async () => {
    const user1 = await Lf3User.create({ name: "WithWhereHas User" });
    const user2 = await Lf3User.create({ name: "No Posts User" });
    const post = await Lf3Post.create({ title: "Featured", lf3_user_id: user1.getAttribute("id") });

    const users = await Lf3User.withWhereHas("posts", (q) =>
      q.where("title", "Featured")
    ).get();

    expect(users.some((u) => u.getAttribute("id") === user1.getAttribute("id"))).toBe(true);
    expect(users.some((u) => u.getAttribute("id") === user2.getAttribute("id"))).toBe(false);

    const found = users.find((u) => u.getAttribute("id") === user1.getAttribute("id"))!;
    expect(found.getRelation("posts")).toBeDefined();
  });
});

// ─── touches ─────────────────────────────────────────────────────────────────

describe("touches", () => {
  beforeAll(setup);

  test("saving child touches listed parent relation updated_at", async () => {
    const user = await Lf3User.create({ name: "Touch User" });
    const post = await Lf3Post.create({ title: "Touch Post", lf3_user_id: user.getAttribute("id") });

    const originalUpdatedAt = post.getAttribute("updated_at");
    await new Promise((r) => setTimeout(r, 10));

    // Lf3User.touches = ["latestPost"] — saving user touches latestPost
    user.setAttribute("name", "Touch User Updated");
    await user.save();

    const refreshedPost = await Lf3Post.find(post.getAttribute("id"));
    expect(refreshedPost!.getAttribute("updated_at")).not.toBe(originalUpdatedAt);
  });
});

// ─── Database transactions ────────────────────────────────────────────────────

describe("Transactions", () => {
  beforeAll(setup);

  test("transaction() commits on success", async () => {
    const connection = Lf3Post.getConnection();
    await connection.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO lf3_posts (title, created_at, updated_at) VALUES ('Tx Post', datetime('now'), datetime('now'))`
      );
    });
    const found = await Lf3Post.where("title", "Tx Post").first();
    expect(found).not.toBeNull();
  });

  test("transaction() rolls back on error", async () => {
    const connection = Lf3Post.getConnection();
    try {
      await connection.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO lf3_posts (title, created_at, updated_at) VALUES ('Rolled Back', datetime('now'), datetime('now'))`
        );
        throw new Error("abort");
      });
    } catch {}
    const found = await Lf3Post.where("title", "Rolled Back").first();
    expect(found).toBeNull();
  });

  test("beginTransaction / commit / rollback manually", async () => {
    const connection = Lf3Post.getConnection();
    await connection.beginTransaction();
    await connection.run(
      `INSERT INTO lf3_posts (title, created_at, updated_at) VALUES ('Manual Tx', datetime('now'), datetime('now'))`
    );
    await connection.rollback();
    const found = await Lf3Post.where("title", "Manual Tx").first();
    expect(found).toBeNull();
  });
});

// ─── Collection.loadMissing ───────────────────────────────────────────────────

describe("Collection.loadMissing()", () => {
  beforeAll(setup);

  test("loads missing relations", async () => {
    const user = await Lf3User.create({ name: "LM User" });
    await Lf3Post.create({ title: "LM Post", lf3_user_id: user.getAttribute("id") });

    const posts = await Lf3Post.where("title", "LM Post").get();
    expect(posts[0].getRelation("author")).toBeUndefined();

    await posts.loadMissing("author");
    expect(posts[0].getRelation("author")).not.toBeUndefined();
    expect(posts[0].getRelation("author").getAttribute("name")).toBe("LM User");
  });

  test("does not reload already-loaded relations", async () => {
    const user = await Lf3User.create({ name: "LM User 2" });
    await Lf3Post.create({ title: "LM Post 2", lf3_user_id: user.getAttribute("id") });

    const posts = await Lf3Post.with("author").where("title", "LM Post 2").get();
    const sentinelValue = "SENTINEL";
    posts[0].setRelation("author", sentinelValue as any);

    await posts.loadMissing("author");
    expect(posts[0].getRelation("author")).toBe(sentinelValue as any);
  });

  test("loads multiple relations", async () => {
    const user = await Lf3User.create({ name: "LM Multi User" });
    const post = await Lf3Post.create({ title: "LM Multi", lf3_user_id: user.getAttribute("id") });
    await Lf3Comment.create({ lf3_post_id: post.getAttribute("id"), body: "hi", status: "pending" });

    const posts = await Lf3Post.where("title", "LM Multi").get();
    await posts.loadMissing("author", "comments");

    expect(posts[0].getRelation("author")).not.toBeUndefined();
    expect(posts[0].getRelation("comments")).not.toBeUndefined();
    expect(posts[0].getRelation("comments")).toHaveLength(1);
  });
});

// ─── HasMany.saveMany / HasMany.createMany ────────────────────────────────────

describe("HasMany.saveMany() / HasMany.createMany()", () => {
  beforeAll(setup);

  test("saveMany sets FK and persists each model", async () => {
    const user = await Lf3User.create({ name: "SaveMany User" });
    const post1 = new Lf3Post({ title: "SaveMany Post 1" });
    const post2 = new Lf3Post({ title: "SaveMany Post 2" });
    await user.posts().saveMany([post1, post2]);

    expect(post1.$exists).toBe(true);
    expect(post1.getAttribute("lf3_user_id")).toBe(user.getAttribute("id"));
    expect(post2.$exists).toBe(true);
    expect(post2.getAttribute("lf3_user_id")).toBe(user.getAttribute("id"));

    const posts = await user.posts().get();
    const titles = posts.map((p) => p.getAttribute("title"));
    expect(titles).toContain("SaveMany Post 1");
    expect(titles).toContain("SaveMany Post 2");
  });

  test("createMany sets FK, creates, and returns models", async () => {
    const user = await Lf3User.create({ name: "CreateMany User" });

    const posts = await user.posts().createMany([
      { title: "CreateMany Post A" },
      { title: "CreateMany Post B" },
    ]);

    expect(posts).toHaveLength(2);
    expect(posts[0].$exists).toBe(true);
    expect(posts[0].getAttribute("lf3_user_id")).toBe(user.getAttribute("id"));
    expect(posts[1].getAttribute("title")).toBe("CreateMany Post B");

    const db = await user.posts().get();
    expect(db.length).toBeGreaterThanOrEqual(2);
  });
});
