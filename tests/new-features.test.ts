import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, BelongsToMany, AttributeDefinition } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

// ─── Models ──────────────────────────────────────────────────────────────────

class Article extends Model {
  static table = "nf_articles";
  static accessors: Record<string, AttributeDefinition> = {
    title: {
      get: (value: string) => (value ? value.toUpperCase() : value),
      set: (value: string) => (value ? value.trim() : value),
    },
    full_name: {
      get: (_value: any, attributes: Record<string, any>) =>
        `${attributes.first_name ?? ""} ${attributes.last_name ?? ""}`.trim(),
    },
  };
}

class NfUser extends Model {
  static table = "nf_users";
  tags() {
    return this.belongsToMany(NfTag, "nf_tag_nf_user", "nf_user_id", "nf_tag_id");
  }
}

class NfTag extends Model {
  static table = "nf_tags";
  users() {
    return this.belongsToMany(NfUser, "nf_tag_nf_user", "nf_tag_id", "nf_user_id");
  }
}

class NfItem extends Model {
  static table = "nf_items";
  static timestamps = false;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

async function setupArticles() {
  setupTestDb();
  await Schema.create("nf_articles", (table) => {
    table.increments("id");
    table.string("title").nullable();
    table.string("first_name").nullable();
    table.string("last_name").nullable();
    table.timestamps();
  });
}

async function setupPivot() {
  setupTestDb();
  await Schema.create("nf_users", (table) => {
    table.increments("id");
    table.string("name");
    table.timestamps();
  });
  await Schema.create("nf_tags", (table) => {
    table.increments("id");
    table.string("label");
    table.timestamps();
  });
  await Schema.create("nf_tag_nf_user", (table) => {
    table.increments("id");
    table.integer("nf_user_id");
    table.integer("nf_tag_id");
    table.integer("weight").nullable();
    table.timestamps();
  });
}

async function setupItems() {
  setupTestDb();
  await Schema.create("nf_items", (table) => {
    table.increments("id");
    table.string("name");
  });
}

// ─── wasRecentlyCreated ───────────────────────────────────────────────────────

describe("wasRecentlyCreated", () => {
  beforeAll(setupArticles);

  test("false on fetched model", async () => {
    await Article.create({ title: "old" });
    const found = await Article.first();
    expect(found!.$wasRecentlyCreated).toBe(false);
  });

  test("true after create()", async () => {
    const article = await Article.create({ title: "new" });
    expect(article.$wasRecentlyCreated).toBe(true);
  });

  test("false on unsaved model", () => {
    const article = new Article({ title: "draft" });
    expect(article.$wasRecentlyCreated).toBe(false);
  });

  test("false after second save() (update)", async () => {
    const article = await Article.create({ title: "created" });
    expect(article.$wasRecentlyCreated).toBe(true);
    article.setAttribute("title", "updated");
    await article.save();
    expect(article.$wasRecentlyCreated).toBe(false);
  });
});

// ─── is() / isNot() ──────────────────────────────────────────────────────────

describe("is() / isNot()", () => {
  beforeAll(setupArticles);

  test("is() returns true for same record", async () => {
    const a = await Article.create({ title: "same" });
    const b = await Article.find(a.getAttribute("id"));
    expect(a.is(b)).toBe(true);
  });

  test("is() returns false for different records", async () => {
    const a = await Article.create({ title: "one" });
    const b = await Article.create({ title: "two" });
    expect(a.is(b)).toBe(false);
  });

  test("is() returns false for null", async () => {
    const a = await Article.create({ title: "x" });
    expect(a.is(null)).toBe(false);
  });

  test("isNot() is inverse of is()", async () => {
    const a = await Article.create({ title: "y" });
    const b = await Article.find(a.getAttribute("id"));
    expect(a.isNot(b)).toBe(false);
    const c = await Article.create({ title: "z" });
    expect(a.isNot(c)).toBe(true);
  });
});

// ─── Attribute accessors / mutators ──────────────────────────────────────────

describe("Attribute accessors / mutators", () => {
  beforeAll(setupArticles);

  test("get accessor transforms value on read", async () => {
    await Article.create({ title: "hello" });
    const article = await Article.orderBy("id", "desc").first();
    expect(article!.getAttribute("title")).toBe("HELLO");
  });

  test("set mutator transforms value on write", async () => {
    const article = new Article();
    article.setAttribute("title", "  spaced  ");
    expect(article.$attributes["title"]).toBe("spaced");
  });

  test("computed accessor (no db column) from multiple attributes", async () => {
    const article = new Article({ first_name: "John", last_name: "Doe" });
    expect(article.getAttribute("full_name")).toBe("John Doe");
  });

  test("proxy access uses get accessor", async () => {
    await Article.create({ title: "proxy" });
    const article = await Article.orderBy("id", "desc").first() as any;
    expect(article.title).toBe("PROXY");
  });
});

// ─── toggle() ────────────────────────────────────────────────────────────────

describe("BelongsToMany toggle()", () => {
  beforeAll(setupPivot);

  test("attaches records not yet attached", async () => {
    const user = await NfUser.create({ name: "Toggle User" });
    const tag1 = await NfTag.create({ label: "a" });
    const tag2 = await NfTag.create({ label: "b" });

    const result = await user.tags().toggle([tag1.getAttribute("id"), tag2.getAttribute("id")]);
    expect(result.attached).toHaveLength(2);
    expect(result.detached).toHaveLength(0);

    const tags = await user.tags().getResults();
    expect(tags).toHaveLength(2);
  });

  test("detaches already attached records", async () => {
    const user = await NfUser.create({ name: "Toggle User 2" });
    const tag = await NfTag.create({ label: "c" });
    await user.tags().attach(tag.getAttribute("id"));

    const result = await user.tags().toggle(tag.getAttribute("id"));
    expect(result.detached).toHaveLength(1);
    expect(result.attached).toHaveLength(0);

    const tags = await user.tags().getResults();
    expect(tags).toHaveLength(0);
  });

  test("mixed toggle: attaches new, detaches existing", async () => {
    const user = await NfUser.create({ name: "Toggle User 3" });
    const tag1 = await NfTag.create({ label: "d" });
    const tag2 = await NfTag.create({ label: "e" });
    await user.tags().attach(tag1.getAttribute("id"));

    const result = await user.tags().toggle([tag1.getAttribute("id"), tag2.getAttribute("id")]);
    expect(result.detached).toContain(tag1.getAttribute("id"));
    expect(result.attached).toContain(tag2.getAttribute("id"));

    const tags = await user.tags().getResults();
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute("label")).toBe("e");
  });
});

// ─── wherePivot() ────────────────────────────────────────────────────────────

describe("BelongsToMany wherePivot()", () => {
  beforeAll(setupPivot);

  test("wherePivot filters results by pivot column", async () => {
    const user = await NfUser.create({ name: "Pivot User" });
    const tag1 = await NfTag.create({ label: "heavy" });
    const tag2 = await NfTag.create({ label: "light" });
    await user.tags().attach(tag1.getAttribute("id"), { weight: 10 });
    await user.tags().attach(tag2.getAttribute("id"), { weight: 1 });

    const heavy = await user.tags().wherePivot("weight", ">", 5).getResults();
    expect(heavy).toHaveLength(1);
    expect(heavy[0].getAttribute("label")).toBe("heavy");
  });

  test("wherePivotIn filters by pivot column IN list", async () => {
    const user = await NfUser.create({ name: "Pivot User 2" });
    const tag1 = await NfTag.create({ label: "w1" });
    const tag2 = await NfTag.create({ label: "w2" });
    const tag3 = await NfTag.create({ label: "w3" });
    await user.tags().attach(tag1.getAttribute("id"), { weight: 1 });
    await user.tags().attach(tag2.getAttribute("id"), { weight: 2 });
    await user.tags().attach(tag3.getAttribute("id"), { weight: 3 });

    const filtered = await user.tags().wherePivotIn("weight", [1, 3]).getResults();
    expect(filtered).toHaveLength(2);
    const labels = filtered.map((t) => t.getAttribute("label"));
    expect(labels).toContain("w1");
    expect(labels).toContain("w3");
  });

  test("wherePivotNull filters by IS NULL pivot column", async () => {
    const user = await NfUser.create({ name: "Pivot User 3" });
    const tag1 = await NfTag.create({ label: "nullish" });
    const tag2 = await NfTag.create({ label: "valued" });
    await user.tags().attach(tag1.getAttribute("id"));
    await user.tags().attach(tag2.getAttribute("id"), { weight: 5 });

    const nullOnes = await user.tags().wherePivotNull("weight").getResults();
    expect(nullOnes).toHaveLength(1);
    expect(nullOnes[0].getAttribute("label")).toBe("nullish");
  });

  test("wherePivot applies during eager loading via Builder.where", async () => {
    const user = await NfUser.create({ name: "Pivot Eager" });
    const tag1 = await NfTag.create({ label: "ea" });
    const tag2 = await NfTag.create({ label: "eb" });
    await user.tags().attach(tag1.getAttribute("id"), { weight: 99 });
    await user.tags().attach(tag2.getAttribute("id"), { weight: 1 });

    const users = await NfUser.with({
      tags: (q) => q.where("nf_tag_nf_user.weight", ">", 50),
    }).where("id", user.getAttribute("id")).get();

    const loadedTags = users[0].getRelation("tags");
    expect(loadedTags).toHaveLength(1);
    expect(loadedTags[0].getAttribute("label")).toBe("ea");
  });
});

// ─── chunkById() / eachById() ────────────────────────────────────────────────

describe("chunkById() / eachById()", () => {
  beforeAll(setupItems);

  test("chunkById iterates all rows in ID order", async () => {
    for (let i = 1; i <= 7; i++) {
      await NfItem.create({ name: `Item ${i}` });
    }

    const names: string[] = [];
    await NfItem.chunkById(3, (items) => {
      for (const item of items) names.push(item.getAttribute("name"));
    });

    expect(names).toHaveLength(7);
    expect(names[0]).toBe("Item 1");
    expect(names[6]).toBe("Item 7");
  });

  test("chunkById chunks respect chunk size", async () => {
    const chunkSizes: number[] = [];
    await NfItem.chunkById(3, (items) => {
      chunkSizes.push(items.length);
    });
    expect(chunkSizes[0]).toBe(3);
    expect(chunkSizes[1]).toBe(3);
    expect(chunkSizes[2]).toBe(1);
  });

  test("eachById yields individual items in ID order", async () => {
    const names: string[] = [];
    await NfItem.eachById(3, (item) => {
      names.push(item.getAttribute("name"));
    });
    expect(names).toHaveLength(7);
    expect(names[0]).toBe("Item 1");
  });

  test("chunkById with filter only iterates matching rows", async () => {
    const names: string[] = [];
    await NfItem.where("name", "like", "%3%").chunkById(10, (items) => {
      for (const item of items) names.push(item.getAttribute("name"));
    });
    expect(names).toHaveLength(1);
    expect(names[0]).toBe("Item 3");
  });
});
