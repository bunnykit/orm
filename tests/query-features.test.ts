import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, Builder } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class Event extends Model {
  static table = "events";
}

describe("Date Where Clauses", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("events", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamp("happened_at");
      table.timestamps();
    });

    await Event.create({ name: "New Year 2023", happened_at: "2023-01-01 00:00:00" });
    await Event.create({ name: "Christmas 2023", happened_at: "2023-12-25 12:30:00" });
    await Event.create({ name: "Mid 2024", happened_at: "2024-06-15 08:15:00" });
    await Event.create({ name: "New Year 2025", happened_at: "2025-01-01 00:00:00" });
  });

  test("whereDate filters by date", async () => {
    const events = await Event.whereDate("happened_at", "2023-01-01").get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("New Year 2023");
  });

  test("whereDay filters by day", async () => {
    const events = await Event.whereDay("happened_at", 1).get();
    expect(events.length).toBe(2);
    const names = events.map((e: any) => e.name).sort();
    expect(names).toEqual(["New Year 2023", "New Year 2025"]);
  });

  test("whereMonth filters by month", async () => {
    const events = await Event.whereMonth("happened_at", 12).get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("Christmas 2023");
  });

  test("whereYear filters by year", async () => {
    const events = await Event.whereYear("happened_at", 2024).get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("Mid 2024");
  });

  test("whereTime filters by time", async () => {
    const events = await Event.whereTime("happened_at", "12:30:00").get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("Christmas 2023");
  });

  test("orWhereDate combines with OR", async () => {
    const events = await Event.whereYear("happened_at", 2023).orWhereDate("happened_at", "2025-01-01").get();
    expect(events.length).toBe(3);
  });

  test("date where with operator", async () => {
    const events = await Event.whereYear("happened_at", ">", 2023).get();
    expect(events.length).toBe(2);
  });
});

describe("Where Not", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("events", (table) => {
      table.increments("id");
      table.string("name");
      table.string("status");
      table.timestamps();
    });

    await Event.create({ name: "A", status: "active" });
    await Event.create({ name: "B", status: "inactive" });
    await Event.create({ name: "C", status: "active" });
  });

  test("whereNot with single column", async () => {
    const events = await Event.whereNot("status", "active").get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("B");
  });

  test("whereNot with object", async () => {
    const events = await Event.whereNot({ status: "active" }).get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("B");
  });

  test("orWhereNot", async () => {
    const events = await Event.where("name", "A").orWhereNot("status", "active").get();
    expect(events.length).toBe(2);
    const names = events.map((e: any) => e.name).sort();
    expect(names).toEqual(["A", "B"]);
  });
});

describe("Latest / Oldest", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("events", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });

    await Event.create({ name: "First" });
    await new Promise((r) => setTimeout(r, 10));
    await Event.create({ name: "Second" });
    await new Promise((r) => setTimeout(r, 10));
    await Event.create({ name: "Third" });
  });

  test("latest orders by created_at desc", async () => {
    const event = await Event.latest().first();
    expect(event!.name).toBe("Third");
  });

  test("oldest orders by created_at asc", async () => {
    const event = await Event.oldest().first();
    expect(event!.name).toBe("First");
  });

  test("latest with custom column", async () => {
    const event = await Event.latest("name").first();
    expect(event!.name).toBe("Third");
  });
});

describe("Conditional Query Building", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("events", (table) => {
      table.increments("id");
      table.string("name");
      table.string("category").nullable();
      table.timestamps();
    });

    await Event.create({ name: "A", category: "sport" });
    await Event.create({ name: "B", category: "music" });
    await Event.create({ name: "C", category: "sport" });
  });

  test("when adds clause when condition is true", async () => {
    const events = await Event.when(true, (query) => query.where("category", "sport")).get();
    expect(events.length).toBe(2);
  });

  test("when skips clause when condition is false", async () => {
    const events = await Event.when(false, (query) => query.where("category", "sport")).get();
    expect(events.length).toBe(3);
  });

  test("when with default callback", async () => {
    const events = await Event.when(false,
      (query) => query.where("category", "sport"),
      (query) => query.where("category", "music")
    ).get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("B");
  });

  test("unless adds clause when condition is false", async () => {
    const events = await Event.unless(false, (query) => query.where("category", "sport")).get();
    expect(events.length).toBe(2);
  });

  test("unless skips clause when condition is true", async () => {
    const events = await Event.unless(true, (query) => query.where("category", "sport")).get();
    expect(events.length).toBe(3);
  });

  test("tap applies callback and returns builder", async () => {
    const events = await Event.tap((query) => query.where("category", "music")).get();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("B");
  });
});
