import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, rmdir, readdir, unlink } from "fs/promises";
import { join } from "path";
import { Connection, Schema, Migration, Migrator, MigrationCreator } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

const TEST_MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_migrations");

describe("MigrationCreator", () => {
  test("creates migration file with class", async () => {
    await mkdir(TEST_MIGRATIONS_DIR, { recursive: true });
    const creator = new MigrationCreator();
    const path = await creator.create("CreateUsersTable", TEST_MIGRATIONS_DIR);
    expect(path).toContain("create_users_table");
    const content = await Bun.file(path).text();
    expect(content).toContain("extends Migration");
    expect(content).toContain("async up()");
    expect(content).toContain("async down()");
    await unlink(path);
  });
});

describe("Migrator", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = setupTestDb();
    await mkdir(TEST_MIGRATIONS_DIR, { recursive: true });
  });

  afterAll(async () => {
    const files = await readdir(TEST_MIGRATIONS_DIR);
    for (const f of files) {
      await unlink(join(TEST_MIGRATIONS_DIR, f));
    }
  });

  test("creates migrations table on first run", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    await migrator.run();
    expect(await Schema.hasTable("migrations")).toBe(true);
  });

  test("runs pending migrations", async () => {
    const fileName = `20260101000000_create_test_items.ts`;
    const filePath = join(TEST_MIGRATIONS_DIR, fileName);
    const content = `
import { Migration, Schema } from "../../src/index.js";
export default class CreateTestItems extends Migration {
  async up(): Promise<void> {
    await Schema.create("test_items", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("test_items");
  }
}`;
    await Bun.write(filePath, content);

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    await migrator.run();
    expect(await Schema.hasTable("test_items")).toBe(true);
  });

  test("status shows ran migrations", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    const status = await migrator.status();
    const ran = status.filter((s) => s.status === "Ran");
    expect(ran.length).toBeGreaterThanOrEqual(1);
  });

  test("rollback undoes last batch", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    await migrator.rollback();
    expect(await Schema.hasTable("test_items")).toBe(false);
  });

  test("status shows pending after rollback", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    const status = await migrator.status();
    const pending = status.filter((s) => s.status === "Pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  test("regenerates types after migration when typesOutDir is set", async () => {
    const typesDir = join(process.cwd(), "tests", "temp_migration_types");
    const fileName = `20260301000000_create_type_test_table.ts`;
    const filePath = join(TEST_MIGRATIONS_DIR, fileName);
    const content = `
import { Migration, Schema } from "../../src/index.js";
export default class CreateTypeTestTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("type_test_table", (table) => {
      table.increments("id");
      table.string("label");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("type_test_table");
  }
}`;
    await Bun.write(filePath, content);

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR, typesDir);
    await migrator.run();

    // Verify types were generated
    const files = await readdir(typesDir);
    expect(files).toContain("type_test_table.d.ts");
    expect(files).toContain("index.d.ts");

    const content_gen = await Bun.file(join(typesDir, "type_test_table.d.ts")).text();
    expect(content_gen).toContain("export interface TypeTestTableAttributes {");
    expect(content_gen).toContain("label: string;");

    // Cleanup
    await unlink(filePath);
    const typeFiles = await readdir(typesDir);
    for (const f of typeFiles) {
      await unlink(join(typesDir, f));
    }
    await rmdir(typesDir);
  });
});
