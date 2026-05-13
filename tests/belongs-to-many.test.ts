import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Connection, Model, Schema } from "../src/index.js";
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

class BPost extends Model {
  static table = "b_posts";
  tags() {
    return this.belongsToMany(BTag, "b_post_tags").withPivot("created_at", "id", "category");
  }

  prerequisiteTags() {
    return this.belongsToMany(BTag, "b_post_tags", "b_post_id", "b_tag_id")
      .withPivot("type")
      .wherePivot("type", "pre");
  }

  corequisiteTags() {
    return this.belongsToMany(BTag, "b_post_tags", "b_post_id", "b_tag_id")
      .withPivot("type")
      .wherePivot("type", "co");
  }
}

class BTag extends Model {
  static table = "b_tags";
  static keyType = "uuid";
}

class BItem extends Model {
  static table = "b_items";
  static keyType = "uuid";
  tags() {
    return this.belongsToMany(BTag, "b_item_tags").withPivot("notes", "id");
  }
}

class Section extends Model {
  static table = "btm_sections";
  students() {
    return this.belongsToMany(Student, Offering);
  }
}

class Student extends Model {
  static table = "btm_students";
}

class Offering extends Model {
  static table = "btm_offerings";
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
    await Schema.create("b_posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("b_tags", (table) => {
      table.uuid("id").primary();
      table.string("name");
      table.timestamps();
    });
    await Schema.create("b_post_tags", (table) => {
      table.uuid("id").primary();
      table.integer("b_post_id");
      table.integer("b_tag_id");
      table.string("category").nullable();
      table.string("type").nullable();
      table.timestamps();
    });
    await Schema.create("b_items", (table) => {
      table.uuid("id").primary();
      table.string("name");
      table.timestamps();
    });
    await Schema.create("b_item_tags", (table) => {
      table.uuid("id").primary();
      table.uuid("b_item_id");
      table.uuid("b_tag_id");
      table.string("notes").nullable();
      table.timestamps();
    });
    await Schema.create("btm_sections", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("btm_students", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("btm_offerings", (table) => {
      table.increments("id");
      table.integer("section_id");
      table.integer("student_id");
      table.timestamps();
    });
  });

  test("attach adds pivot rows", async () => {
    const user = await BUser.create({ name: "Alice" });
    const role = await BRole.create({ title: "Admin" });

    await user.roles().attach(role.getAttribute("id"));

    const roles = await user.roles().getResults();
    expect(roles).toBeInstanceOf(Collection);
    expect(roles).toHaveLength(1);
    expect(roles[0].getAttribute("title")).toBe("Admin");
  });

  test("belongsToMany can use a pivot model to infer the pivot table", async () => {
    const section = await Section.create({ name: "A" });
    const student = await Student.create({ name: "Ada" });

    await section.students().attach(student.getAttribute("id"));

    const students = await section.students().getResults();
    expect(students).toHaveLength(1);
    expect(students[0].getAttribute("name")).toBe("Ada");

    const sql = section.students().getQuery().toSql();
    expect(sql).toContain('"btm_offerings"');
    expect(sql).toContain('"btm_offerings"."section_id"');
    expect(sql).toContain('"btm_offerings"."student_id"');
  });

  test("belongsToMany existence queries qualify pivot table with PostgreSQL schema", () => {
    class SchemaUser extends Model {
      static table = "schema_users";
      roles() {
        return this.belongsToMany(SchemaRole, "schema_role_user", "schema_user_id", "schema_role_id");
      }
    }
    class SchemaRole extends Model {
      static table = "schema_roles";
    }

    const connection = new Connection({ url: "postgres://user:pass@localhost:5432/db", schema: "tenant_demo" });
    (SchemaUser as any).connection = connection;

    const sql = SchemaUser.withExists("roles", "has_roles").toSql();

    expect(sql).toContain('INNER JOIN "tenant_demo"."schema_role_user"');
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

  test("sync sets pivot attributes", async () => {
    const post = await BPost.create({ title: "Test Post" });
    const tag1 = await BTag.create({ name: "JS" });
    const tag2 = await BTag.create({ name: "TS" });

    await post.tags().sync([tag1.getAttribute("id"), tag2.getAttribute("id")], { category: "programming" });

    const tags = await post.tags().getResults();
    expect(tags).toHaveLength(2);
    expect(tags[0].pivot.category).toBe("programming");
    expect(tags[1].pivot.category).toBe("programming");
    expect(tags[0].pivot.id).toBeDefined();
  });

  test("syncWithoutDetaching sets pivot attributes", async () => {
    const post = await BPost.create({ title: "Post 2" });
    const tag1 = await BTag.create({ name: "Node" });
    const tag2 = await BTag.create({ name: "React" });

    await post.tags().syncWithoutDetaching([tag1.getAttribute("id")], { category: "frontend" });

    const tags = await post.tags().getResults();
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute("name")).toBe("Node");
    expect(tags[0].pivot.category).toBe("frontend");

    await post.tags().syncWithoutDetaching([tag2.getAttribute("id")], { category: "frontend" });

    const tags2 = await post.tags().getResults();
    expect(tags2).toHaveLength(2);
  });

  test("sync applies and scopes equality wherePivot attributes", async () => {
    const post = await BPost.create({ title: "Requirements" });
    const tag1 = await BTag.create({ name: "Prerequisite 1" });
    const tag2 = await BTag.create({ name: "Corequisite" });
    const tag3 = await BTag.create({ name: "Prerequisite 2" });

    const firstPreSync = await post.prerequisiteTags().sync([tag1.getAttribute("id")]);
    const firstCoSync = await post.corequisiteTags().sync([tag2.getAttribute("id")]);
    expect(firstPreSync).toEqual({ attached: [tag1.getAttribute("id")], detached: [] });
    expect(firstCoSync).toEqual({ attached: [tag2.getAttribute("id")], detached: [] });

    let prerequisites = await post.prerequisiteTags().getResults();
    let corequisites = await post.corequisiteTags().getResults();
    expect(prerequisites).toHaveLength(1);
    expect(corequisites).toHaveLength(1);
    expect(prerequisites[0].pivot.type).toBe("pre");
    expect(corequisites[0].pivot.type).toBe("co");

    const secondPreSync = await post.prerequisiteTags().sync([tag3.getAttribute("id")]);
    expect(secondPreSync).toEqual({ attached: [tag3.getAttribute("id")], detached: [tag1.getAttribute("id")] });

    prerequisites = await post.prerequisiteTags().getResults();
    corequisites = await post.corequisiteTags().getResults();
    expect(prerequisites).toHaveLength(1);
    expect(prerequisites[0].getAttribute("name")).toBe("Prerequisite 2");
    expect(prerequisites[0].pivot.type).toBe("pre");
    expect(corequisites).toHaveLength(1);
    expect(corequisites[0].getAttribute("name")).toBe("Corequisite");
    expect(corequisites[0].pivot.type).toBe("co");
  });

  test("eager loading belongsToMany", async () => {
    const user = await BUser.create({ name: "Dana" });
    const role = await BRole.create({ title: "Manager" });
    await user.roles().attach(role.getAttribute("id"));

    const users = await BUser.with("roles").where("id", user.getAttribute("id")).get();
    expect(users[0].getRelation("roles")).toBeInstanceOf(Collection);
    expect(users[0].getRelation("roles")).toHaveLength(1);
    expect(users[0].getRelation("roles")[0].getAttribute("title")).toBe("Manager");
  });

  test("eager loading with wherePivot on belongsToMany constraint", async () => {
    const post = await BPost.create({ title: "Filtered eager load" });
    const tag1 = await BTag.create({ name: "Frontend" });
    const tag2 = await BTag.create({ name: "Backend" });

    await post.tags().attach(tag1.getAttribute("id"), { category: "programming" });
    await post.tags().attach(tag2.getAttribute("id"), { category: "design" });

    const posts = await BPost.with({
      tags: (query) => query.wherePivot("category", "programming"),
    }).where("id", post.getAttribute("id")).get();

    expect(posts).toHaveLength(1);
    const tags = posts[0].getRelation("tags");
    expect(tags).toBeInstanceOf(Collection);
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute("name")).toBe("Frontend");
    expect(tags[0].pivot.category).toBe("programming");
  });

  test("attach generates UUID for pivot table with UUID primary key", async () => {
    const item = await BItem.create({ name: "Item 1" });
    const tag = await BTag.create({ name: "Tag 1" });

    const pivotId = await item.tags().attach(tag.getAttribute("id"), { notes: "test note" });

    expect(pivotId).toBeDefined();
    expect(pivotId).not.toBeNull();
    expect(typeof pivotId).toBe("string");
    expect(pivotId.length).toBeGreaterThan(0);

    const tags = await item.tags().getResults();
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute("name")).toBe("Tag 1");
    expect(tags[0].pivot.notes).toBe("test note");
    expect(tags[0].pivot.id).toBe(pivotId);
  });
});
