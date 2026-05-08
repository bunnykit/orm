import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class EAuthor extends Model {
  static table = "e_authors";
  static timestamps = false;
  books() {
    return this.hasMany(EBook, "author_id");
  }
  profile() {
    return this.hasOne(EProfile, "author_id");
  }
}

class EBook extends Model {
  static table = "e_books";
  static timestamps = false;
  author() {
    return this.belongsTo(EAuthor, "author_id");
  }
}

class EProfile extends Model {
  static table = "e_profiles";
  static timestamps = false;
  author() {
    return this.belongsTo(EAuthor, "author_id");
  }
}

describe("Eager Loading", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("e_authors", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("e_books", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.string("title");
    });
    await Schema.create("e_profiles", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.text("bio").nullable();
    });
  });

  test("with loads hasMany relation in single query", async () => {
    const author = await EAuthor.create({ name: "Alice" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book A" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book B" });

    const authors = await EAuthor.with("books").where("name", "Alice").get();
    expect(authors).toHaveLength(1);
    const loaded = authors[0].getRelation("books");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].getAttribute("title")).toBe("Book A");
  });

  test("with loads belongsTo relation", async () => {
    const author = await EAuthor.create({ name: "Bob" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book C" });

    const books = await EBook.with("author").where("title", "Book C").get();
    expect(books).toHaveLength(1);
    expect(books[0].getRelation("author").getAttribute("name")).toBe("Bob");
  });

  test("with loads hasOne relation", async () => {
    const author = await EAuthor.create({ name: "Carl" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Hello" });

    const authors = await EAuthor.with("profile").where("name", "Carl").get();
    expect(authors).toHaveLength(1);
    expect(authors[0].getRelation("profile").getAttribute("bio")).toBe("Hello");
  });

  test("with loads multiple relations", async () => {
    const author = await EAuthor.create({ name: "Dana" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book D" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Bio D" });

    const authors = await EAuthor.with("books", "profile").where("name", "Dana").get();
    expect(authors).toHaveLength(1);
    expect(authors[0].getRelation("books")).toHaveLength(1);
    expect(authors[0].getRelation("profile")).not.toBeNull();
  });

  test("with on first loads relation", async () => {
    const author = await EAuthor.create({ name: "Eve" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book E" });

    const found = await EAuthor.with("books").where("name", "Eve").first();
    expect(found).not.toBeNull();
    expect(found!.getRelation("books")).toHaveLength(1);
  });
});
