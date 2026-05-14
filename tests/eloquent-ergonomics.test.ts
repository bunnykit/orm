import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

interface ErgUserAttrs {
  id: number;
  name: string;
  group_name: string;
  score: number;
}

class ErgUser extends Model.define<ErgUserAttrs>("erg_users") {
  declare label: string;
  declare upper_name: string;

  static appends = ["label"];
  static accessors = {
    label: {
      get: (_value: any, attributes: ErgUserAttrs) => `${attributes.name}:${attributes.score}`,
    },
    upper_name: {
      get: (_value: any, attributes: ErgUserAttrs) => attributes.name.toUpperCase(),
    },
  };
}

describe("Eloquent-style ergonomics", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("erg_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("group_name");
      table.integer("score");
      table.timestamps();
    });

    for (let i = 1; i <= 6; i++) {
      await ErgUser.create({
        name: `User ${i}`,
        group_name: i % 2 === 0 ? "even" : "odd",
        score: i,
      });
    }
  });

  test("whereKey, whereKeyNot, findMany, and firstWhere filter by primary keys and typed columns", async () => {
    const one = await ErgUser.whereKey(1).first();
    expect(one?.name).toBe("User 1");

    const some = await ErgUser.whereKey([1, 3]).orderBy("id").get();
    expect(some.map((user) => user.id)).toEqual([1, 3]);

    const others = await ErgUser.whereKeyNot([1, 2]).orderBy("id").get();
    expect(others.map((user) => user.id)).toEqual([3, 4, 5, 6]);

    const found = await ErgUser.findMany([2, 4]);
    expect(found).toBeInstanceOf(Collection);
    expect(found.map((user) => user.name).sort()).toEqual(["User 2", "User 4"]);

    const first = await ErgUser.firstWhere("score", ">", 4);
    expect(first?.score).toBe(5);

    if (false) {
      const typed = await ErgUser.firstWhere("name", "User 1");
      typed?.name.toUpperCase();
      // @ts-expect-error Unknown columns should not be suggested.
      await ErgUser.firstWhere("missing", "value");
      // @ts-expect-error findMany returns ErgUser models, not arbitrary fields.
      found[0]?.missing;
    }
  });

  test("orderByRaw and groupByRaw support raw SQL clauses", async () => {
    const ordered = await ErgUser.orderByRaw("score + 1 DESC").get();
    expect(ordered[0].score).toBe(6);

    const grouped = await ErgUser.query()
      .select("group_name")
      .selectRaw("COUNT(*) as total")
      .groupByRaw("group_name")
      .orderByRaw("total DESC")
      .get();

    expect(grouped).toHaveLength(2);
    expect(grouped[0].getAttribute("total")).toBe(3);

    if (false) {
      ErgUser.orderByRaw("score DESC");
      ErgUser.groupByRaw("group_name");
    }
  });

  test("chunkByIdDesc and lazyById iterate by primary key without offsets", async () => {
    const descIds: number[] = [];
    await ErgUser.chunkByIdDesc(2, (users) => {
      descIds.push(...users.map((user) => user.id));
    });
    expect(descIds).toEqual([6, 5, 4, 3, 2, 1]);

    const lazyIds: number[] = [];
    for await (const user of ErgUser.lazyById(2)) {
      lazyIds.push(user.id);
    }
    expect(lazyIds).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("static appends and append() include computed accessors in JSON", async () => {
    const user = await ErgUser.findOrFail(1);

    const json = user.json();
    expect(json.label).toBe("User 1:1");

    const appended = user.append("upper_name");
    const appendedJson = appended.json();
    expect(appendedJson.upper_name).toBe("USER 1");

    user.makeHidden("label");
    expect(user.json()).not.toHaveProperty("label");

    if (false) {
      const typed = appended.json();
      typed.upper_name;
      typed.label;
      // @ts-expect-error Appended JSON rows should not admit unknown keys.
      typed.missing;
    }
  });
});
