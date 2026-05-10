import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, ObserverRegistry } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class ObservedUser extends Model {
  static table = "observed_users";
}

class CleanSaveUser extends Model {
  static table = "clean_save_users";
}

class UnsavedDeleteUser extends Model {
  static table = "unsaved_delete_users";
}

describe("Observers", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("observed_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("clean_save_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
  });

  test("fires creating and created events", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      creating() {
        events.push("creating");
      },
      created() {
        events.push("created");
      },
    });

    await ObservedUser.create({ name: "Alice" });
    expect(events).toContain("creating");
    expect(events).toContain("created");
  });

  test("can suppress events during create", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      creating() {
        events.push("creating");
      },
      created() {
        events.push("created");
      },
    });

    await ObservedUser.create({ name: "Silent Alice" }, { events: false });
    expect(events).toEqual([]);
  });

  test("fires updating and updated events", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      updating() {
        events.push("updating");
      },
      updated() {
        events.push("updated");
      },
    });

    const user = await ObservedUser.create({ name: "Bob" });
    user.setAttribute("name", "Bob 2");
    await user.save();
    expect(events).toContain("updating");
    expect(events).toContain("updated");
  });

  test("fires saving and saved events on create and update", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      saving() {
        events.push("saving");
      },
      saved() {
        events.push("saved");
      },
    });

    const user = await ObservedUser.create({ name: "Carl" });
    expect(events.filter((e) => e === "saving")).toHaveLength(1);
    expect(events.filter((e) => e === "saved")).toHaveLength(1);

    user.setAttribute("name", "Carl 2");
    await user.save();
    expect(events.filter((e) => e === "saving")).toHaveLength(2);
    expect(events.filter((e) => e === "saved")).toHaveLength(2);
  });

  test("fires deleting and deleted events", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      deleting() {
        events.push("deleting");
      },
      deleted() {
        events.push("deleted");
      },
    });

    const user = await ObservedUser.create({ name: "Dan" });
    await user.delete();
    expect(events).toContain("deleting");
    expect(events).toContain("deleted");
  });

  test("does not fire updating events or touch timestamp when clean model is saved", async () => {
    const events: string[] = [];
    ObserverRegistry.register(CleanSaveUser, {
      saving() {
        events.push("saving");
      },
      updating() {
        events.push("updating");
      },
      updated() {
        events.push("updated");
      },
      saved() {
        events.push("saved");
      },
    });

    const user = await CleanSaveUser.create({ name: "Erin" });
    const originalUpdatedAt = user.updated_at;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await user.save();

    expect(user.updated_at).toBe(originalUpdatedAt);
    expect(events).toEqual(["saving", "saved", "saving", "saved"]);
  });

  test("does not fire delete events for unsaved models", async () => {
    const events: string[] = [];
    ObserverRegistry.register(UnsavedDeleteUser, {
      deleting() {
        events.push("deleting");
      },
      deleted() {
        events.push("deleted");
      },
    });

    const user = new UnsavedDeleteUser({ name: "No row" });
    expect(await user.delete()).toBe(false);
    expect(events).toEqual([]);
  });
});
