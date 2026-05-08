import { expect, test, describe } from "bun:test";
import { Schema } from "../src/index.js";
import { Blueprint } from "../src/schema/Blueprint.js";
import { SQLiteGrammar } from "../src/schema/grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "../src/schema/grammars/MySqlGrammar.js";
import { PostgresGrammar } from "../src/schema/grammars/PostgresGrammar.js";
import { setupTestDb, teardownTestDb } from "./helpers.js";
import type { Connection } from "../src/index.js";

describe("Schema Builder", () => {
  let connection: Connection;

  test("sqlite grammar compileCreate", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("users");
    blueprint.increments("id");
    blueprint.string("name");
    blueprint.timestamps();
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"created_at" TEXT');
  });

  test("mysql grammar compileCreate", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("users");
    blueprint.increments("id");
    blueprint.string("email").unique();
    blueprint.timestamps();
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain("`id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("`email` VARCHAR(255) NOT NULL UNIQUE");
  });

  test("postgres grammar compileCreate", () => {
    const grammar = new PostgresGrammar();
    const blueprint = new Blueprint("users");
    blueprint.bigIncrements("id");
    blueprint.string("name");
    blueprint.timestamps();
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    expect(sql).toContain('"name" VARCHAR(255) NOT NULL');
  });

  test("creates and drops table via Schema", async () => {
    connection = setupTestDb();
    await Schema.create("test_table", (table) => {
      table.increments("id");
      table.string("title");
    });
    expect(await Schema.hasTable("test_table")).toBe(true);
    await Schema.dropIfExists("test_table");
    expect(await Schema.hasTable("test_table")).toBe(false);
  });

  test("adds columns via Schema.table", async () => {
    connection = setupTestDb();
    await Schema.create("alter_test", (table) => {
      table.increments("id");
    });
    await Schema.table("alter_test", (table) => {
      table.string("email").nullable();
    });
    expect(await Schema.hasColumn("alter_test", "email")).toBe(true);
  });

  test("hasTable and hasColumn", async () => {
    connection = setupTestDb();
    await Schema.create("meta_test", (table) => {
      table.increments("id");
      table.string("name");
    });
    expect(await Schema.hasTable("meta_test")).toBe(true);
    expect(await Schema.hasTable("nonexistent")).toBe(false);
    expect(await Schema.hasColumn("meta_test", "name")).toBe(true);
    expect(await Schema.hasColumn("meta_test", "nope")).toBe(false);
  });
});
