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

  test("sqlite grammar compileCreate with uuid primary key", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
    expect(sql).toContain('"name" TEXT NOT NULL');
  });

  test("mysql grammar compileCreate with uuid primary key", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain("`id` CHAR(36) NOT NULL PRIMARY KEY");
    expect(sql).toContain("`name` VARCHAR(255) NOT NULL");
  });

  test("postgres grammar compileCreate with uuid primary key", () => {
    const grammar = new PostgresGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" UUID NOT NULL PRIMARY KEY');
    expect(sql).toContain('"name" VARCHAR(255) NOT NULL');
  });

  test("creates table with uuid primary key via Schema", async () => {
    connection = setupTestDb();
    await Schema.create("uuid_test", (table) => {
      table.uuid("id").primary();
      table.string("name");
    });
    expect(await Schema.hasTable("uuid_test")).toBe(true);
    expect(await Schema.hasColumn("uuid_test", "id")).toBe(true);
    expect(await Schema.hasColumn("uuid_test", "name")).toBe(true);
  });

  test("schema builder supports foreign and morph shortcuts", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("posts");
    blueprint.increments("id");
    blueprint.foreignId("user_id").constrained().cascadeOnDelete();
    blueprint.foreignUuid("team_id");
    blueprint.uuidMorphs("taggable");
    blueprint.nullableMorphs("commentable");

    const sql = grammar.compileCreate(blueprint, "posts");
    expect(sql).toContain('"user_id" INTEGER NOT NULL');
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade');
    expect(sql).toContain('"team_id" TEXT NOT NULL');
    expect(sql).toContain('"taggable_id" TEXT NOT NULL');
    expect(sql).toContain('"taggable_type" TEXT NOT NULL');
    expect(sql).toContain('"commentable_id" INTEGER');
    expect(sql).toContain('"commentable_type" TEXT');
    expect(grammar.compileIndexes(blueprint, "posts")).toContain('CREATE INDEX "posts_taggable_type_taggable_id_index" ON "posts" ("taggable_type", "taggable_id")');
  });

  test("grammar compiles column changes where supported", () => {
    const mysql = new MySqlGrammar();
    const postgres = new PostgresGrammar();
    const blueprint = new Blueprint("users");
    blueprint.string("name", 150).nullable().change();
    const column = blueprint.commands[0].parameters!.column;

    expect(mysql.compileChange("users", column)).toContain("ALTER TABLE `users` MODIFY COLUMN `name` VARCHAR(150)");
    expect(postgres.compileChange("users", column)).toContain('ALTER TABLE "users" ALTER COLUMN "name" TYPE VARCHAR(150)');
  });
});
