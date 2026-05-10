import { beforeEach, describe, expect, test } from "bun:test";
import { Collection, Connection, Model, Schema } from "../src/index.js";

class CollectionUser extends Model {
  static table = "collection_users";
  static timestamps = false;
}

describe("Collection", () => {
  let connection: Connection;

  beforeEach(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("collection_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("role");
      table.integer("score");
    });
    await CollectionUser.insert([
      { name: "Ada", role: "admin", score: 10 },
      { name: "Linus", role: "user", score: 20 },
      { name: "Grace", role: "user", score: 15 },
    ]);
  });

  test("wraps arrays with collection helpers", () => {
    const items = new Collection([
      { name: "Ada", role: "admin", score: 10 },
      { name: "Linus", role: "user", score: 20 },
      { name: "Grace", role: "user", score: 15 },
    ]);

    expect(items).toHaveLength(3);
    expect(items.first()?.name).toBe("Ada");
    expect(items.last()?.name).toBe("Grace");
    expect(items.isNotEmpty()).toBe(true);
    expect(items.pluck("name")).toEqual(["Ada", "Linus", "Grace"]);
    expect(items.where("role", "user").pluck("name")).toEqual(["Linus", "Grace"]);
    expect(items.whereIn("score", [10, 15]).pluck("name")).toEqual(["Ada", "Grace"]);
    expect(items.keyBy("name").Ada.score).toBe(10);
    expect(items.groupBy("role").user.pluck("name")).toEqual(["Linus", "Grace"]);
    expect(items.sortBy("score").pluck("name")).toEqual(["Ada", "Grace", "Linus"]);
    expect(items.sortByDesc("score").pluck("name")).toEqual(["Linus", "Grace", "Ada"]);
    expect(items.take(2).pluck("name")).toEqual(["Ada", "Linus"]);
    expect(items.skip(1).pluck("name")).toEqual(["Linus", "Grace"]);
    expect(items.contains("name", "Ada")).toBe(true);
    expect(items.firstWhere("role", "user")?.name).toBe("Linus");
    expect(items.count()).toBe(3);
    expect(items.sum("score")).toBe(45);
    expect(items.avg("score")).toBe(15);
    expect(items.min("score")).toBe(10);
    expect(items.max("score")).toBe(20);
  });

  test("query get and model all return collections", async () => {
    const users = await CollectionUser.orderBy("id").get();
    expect(users).toBeInstanceOf(Collection);
    expect(users[0].getAttribute("name")).toBe("Ada");
    expect(users.pluck("name")).toEqual(["Ada", "Linus", "Grace"]);
    expect(users.all()).toBeArray();

    const allUsers = await CollectionUser.all();
    expect(allUsers).toBeInstanceOf(Collection);
    expect(allUsers.toArray()).toHaveLength(3);
  });

  test("collections serialize as JSON arrays", async () => {
    const users = await CollectionUser.orderBy("id").get();
    const json = JSON.parse(JSON.stringify(users));
    expect(Array.isArray(json)).toBe(true);
    expect(json.map((user: any) => user.name)).toEqual(["Ada", "Linus", "Grace"]);
  });

  test("collection json aliases toJSON", async () => {
    const users = await CollectionUser.orderBy("id").get();
    expect(users.json()).toEqual(users.toJSON());
  });

  test("query json returns serialized rows", async () => {
    const users = await CollectionUser.query().orderBy("score", "desc").json();
    expect(users).toEqual([
      { id: 2, name: "Linus", role: "user", score: 20 },
      { id: 3, name: "Grace", role: "user", score: 15 },
      { id: 1, name: "Ada", role: "admin", score: 10 },
    ]);
  });

  test("getArray returns a plain array compatibility escape hatch", async () => {
    const users = await CollectionUser.orderBy("id").getArray();
    expect(users).toBeArray();
    expect(users).not.toBeInstanceOf(Collection);
    expect(users.map((user) => user.getAttribute("name"))).toEqual(["Ada", "Linus", "Grace"]);
  });

  test("paginator data and chunk callbacks use collections", async () => {
    const page = await CollectionUser.orderBy("id").paginate(2, 1);
    expect(page.data).toBeInstanceOf(Collection);
    expect(page.data.pluck("name")).toEqual(["Ada", "Linus"]);

    const chunks: Collection<CollectionUser>[] = [];
    await CollectionUser.orderBy("id").chunk(2, (items) => {
      expect(items).toBeInstanceOf(Collection);
      chunks.push(items);
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].pluck("name")).toEqual(["Ada", "Linus"]);
    expect(chunks[1].pluck("name")).toEqual(["Grace"]);
  });
});
