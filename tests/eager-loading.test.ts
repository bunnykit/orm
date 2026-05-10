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
  chapters() {
    return this.hasMany(EChapter, "book_id");
  }
}

class EChapter extends Model {
  static table = "e_chapters";
  static timestamps = false;
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
      table.boolean("published").default(true);
    });
    await Schema.create("e_chapters", (table) => {
      table.increments("id");
      table.integer("book_id");
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

  test("eager loaded relations are available as properties", async () => {
    const author = await EAuthor.create({ name: "Ivy" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book I" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Bio I" });

    const found = await EAuthor.with(["books", "profile"]).where("name", "Ivy").first();
    expect(found).not.toBeNull();
    expect((found as any).books).toHaveLength(1);
    expect((found as any).books[0].getAttribute("title")).toBe("Book I");
    expect((found as any).profile.getAttribute("bio")).toBe("Bio I");
  });

  test("load can refresh an already loaded relation", async () => {
    const author = await EAuthor.create({ name: "Jules" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book J" });

    const found = await EAuthor.with("books").where("name", "Jules").first();
    expect((found as any).books).toHaveLength(1);

    await found!.load("books");
    expect((found as any).books).toHaveLength(1);
  });

  test("with constrains eager loaded hasMany relation", async () => {
    const author = await EAuthor.create({ name: "Frank" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Published", published: true });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Draft", published: false });

    const authors = await EAuthor.with({ books: (query) => query.where("published", true).orderBy("title") })
      .where("name", "Frank")
      .get();

    const books = authors[0].getRelation("books");
    expect(books).toHaveLength(1);
    expect(books[0].getAttribute("title")).toBe("Published");
  });

  test("with constrains nested eager loaded relation without reloading parent relation", async () => {
    const author = await EAuthor.create({ name: "Grace" });
    const publicBook = await EBook.create({ author_id: author.getAttribute("id"), title: "Public", published: true });
    const draftBook = await EBook.create({ author_id: author.getAttribute("id"), title: "Private", published: false });
    await EChapter.create({ book_id: publicBook.getAttribute("id"), title: "Intro" });
    await EChapter.create({ book_id: publicBook.getAttribute("id"), title: "Appendix" });
    await EChapter.create({ book_id: draftBook.getAttribute("id"), title: "Secret" });

    const authors = await EAuthor.with(
      { books: (query) => query.where("published", true) },
      { "books.chapters": (query) => query.where("title", "Intro") }
    )
      .where("name", "Grace")
      .get();

    const books = authors[0].getRelation("books");
    expect(books).toHaveLength(1);
    expect(books[0].getAttribute("title")).toBe("Public");
    expect(books[0].getRelation("chapters").map((chapter: EChapter) => chapter.getAttribute("title"))).toEqual(["Intro"]);
  });

  test("load supports constrained eager loading", async () => {
    const author = await EAuthor.create({ name: "Helen" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Visible", published: true });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Hidden", published: false });

    await author.load({ books: (query) => query.where("published", true) });

    expect(author.getRelation("books").map((book: EBook) => book.getAttribute("title"))).toEqual(["Visible"]);
  });

  test("json includes eager loaded relations", async () => {
    const author = await EAuthor.create({ name: "Kate" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book K" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Bio K" });

    const found = await EAuthor.with("books", "profile").where("name", "Kate").first();
    expect(found).not.toBeNull();

    const json = found!.json();
    expect(json.name).toBe("Kate");
    expect(json.books).toBeInstanceOf(Array);
    expect(json.books).toHaveLength(1);
    expect(json.books[0].title).toBe("Book K");
    expect(json.profile).toBeInstanceOf(Object);
    expect(json.profile.bio).toBe("Bio K");
  });

  test("json includes null relation for missing hasOne", async () => {
    const author = await EAuthor.create({ name: "Leo" });

    const found = await EAuthor.with("profile").where("name", "Leo").first();
    expect(found).not.toBeNull();

    const json = found!.json();
    expect(json.profile).toBeNull();
  });

  test("json with relations false excludes eager loaded relations", async () => {
    const author = await EAuthor.create({ name: "Mia" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book M" });

    const found = await EAuthor.with("books").where("name", "Mia").first();
    expect(found).not.toBeNull();

    const json = found!.json({ relations: false });
    expect(json.name).toBe("Mia");
    expect(json).not.toHaveProperty("books");
  });

  test("json with relations true includes eager loaded relations", async () => {
    const author = await EAuthor.create({ name: "Noah" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book N" });

    const found = await EAuthor.with("books").where("name", "Noah").first();
    expect(found).not.toBeNull();

    const json = found!.json({ relations: true });
    expect(json.name).toBe("Noah");
    expect(json.books).toBeInstanceOf(Array);
    expect(json.books).toHaveLength(1);
  });
});
