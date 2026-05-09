import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class Author extends Model {
  static table = "authors";
  books() {
    return this.hasMany(Book);
  }
  profile() {
    return this.hasOne(Profile);
  }
  latestBook() {
    return this.books().latestOfMany("id");
  }
  firstBook() {
    return this.books().oldestOfMany("id");
  }
}

class Book extends Model {
  static table = "books";
  author() {
    return this.belongsTo(Author);
  }
}

class Profile extends Model {
  static table = "profiles";
  author() {
    return this.belongsTo(Author);
  }
}

class Country extends Model {
  static table = "countries";
  posts() {
    return this.hasManyThrough(CountryPost, CountryUser);
  }
}

class CountryUser extends Model {
  static table = "country_users";
}

class CountryPost extends Model {
  static table = "country_posts";
}

describe("Relations", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("authors", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("books", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("profiles", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.text("bio").nullable();
      table.timestamps();
    });
    await Schema.create("countries", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("country_users", (table) => {
      table.increments("id");
      table.integer("country_id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("country_posts", (table) => {
      table.increments("id");
      table.integer("country_user_id");
      table.string("title");
      table.timestamps();
    });
  });

  test("HasMany returns related models", async () => {
    const author = await Author.create({ name: "Alice" });
    await Book.create({ author_id: author.getAttribute("id"), title: "Book A" });
    await Book.create({ author_id: author.getAttribute("id"), title: "Book B" });

    const books = await author.books().getResults();
    expect(books).toBeInstanceOf(Collection);
    expect(books).toHaveLength(2);
    expect(books[0]).toBeInstanceOf(Book);
    expect(books[0].getAttribute("title")).toBe("Book A");
  });

  test("BelongsTo returns parent model", async () => {
    const author = await Author.create({ name: "Bob" });
    const book = await Book.create({ author_id: author.getAttribute("id"), title: "Book C" });

    const foundAuthor = await book.author().getResults();
    expect(foundAuthor).not.toBeNull();
    expect(foundAuthor!).toBeInstanceOf(Author);
    expect(foundAuthor!.getAttribute("name")).toBe("Bob");
  });

  test("BelongsTo associate and dissociate update the foreign key", async () => {
    const author = await Author.create({ name: "Belongs Parent" });
    const book = new Book({ title: "Detached" });

    book.author().associate(author);
    expect(book.getAttribute("author_id")).toBe(author.getAttribute("id"));

    book.author().dissociate();
    expect(book.getAttribute("author_id")).toBeNull();
  });

  test("HasOne returns single related model", async () => {
    const author = await Author.create({ name: "Charlie" });
    await Profile.create({ author_id: author.getAttribute("id"), bio: "Hello" });

    const profile = await author.profile().getResults();
    expect(profile).not.toBeNull();
    expect(profile!).toBeInstanceOf(Profile);
    expect(profile!.getAttribute("bio")).toBe("Hello");
  });

  test("relation query can be chained", async () => {
    const author = await Author.create({ name: "Dana" });
    await Book.create({ author_id: author.getAttribute("id"), title: "Alpha" });
    await Book.create({ author_id: author.getAttribute("id"), title: "Beta" });

    const query = author.books().getQuery();
    const ordered = await query.orderBy("title", "desc").get();
    expect(ordered[0].getAttribute("title")).toBe("Beta");
  });

  test("one-of-many helpers return latest and oldest related models", async () => {
    const author = await Author.create({ name: "One Of Many" });
    await Book.create({ author_id: author.getAttribute("id"), title: "Old" });
    await Book.create({ author_id: author.getAttribute("id"), title: "New" });

    const latest = await author.latestBook().getResults();
    const oldest = await author.firstBook().getResults();

    expect(latest!.getAttribute("title")).toBe("New");
    expect(oldest!.getAttribute("title")).toBe("Old");
  });

  test("HasManyThrough returns distant related models", async () => {
    const country = await Country.create({ name: "PH" });
    const user = await CountryUser.create({ country_id: country.getAttribute("id"), name: "Ada" });
    await CountryPost.create({ country_user_id: user.getAttribute("id"), title: "Through A" });
    await CountryPost.create({ country_user_id: user.getAttribute("id"), title: "Through B" });

    const posts = await country.posts().getResults();
    expect(posts).toBeInstanceOf(Collection);
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.getAttribute("title"))).toEqual(["Through A", "Through B"]);
  });
});
