import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, readdir, unlink, rm } from "fs/promises";
import { join } from "path";
import { Connection, Schema, Migration, Migrator, MigrationCreator } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

const TEST_MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_migrations");
const TEST_MIGRATIONS_DIR_A = join(process.cwd(), "tests", "temp_migrations_a");
const TEST_MIGRATIONS_DIR_B = join(process.cwd(), "tests", "temp_migrations_b");
const TEST_MIGRATIONS_DIR_C = join(process.cwd(), "tests", "temp_migrations_c");
const TEST_MIGRATIONS_DIR_D = join(process.cwd(), "tests", "temp_migrations_d");

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
    await rm(TEST_MIGRATIONS_DIR, { recursive: true, force: true });
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
    await rm(typesDir, { recursive: true, force: true });
  });

  test("dispatches migration events and dumps schema", async () => {
    const fileName = `20260302000000_create_event_test_table.ts`;
    const filePath = join(TEST_MIGRATIONS_DIR, fileName);
    const dumpPath = join(process.cwd(), "tests", "temp_schema_dump.sql");
    const events: string[] = [];
    const content = `
import { Migration, Schema } from "../../src/index.js";
export default class CreateEventTestTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("event_test_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("event_test_table");
  }
}`;
    await Bun.write(filePath, content);

    Migrator.clearListeners();
    Migrator.on("migrating", ({ migration }) => events.push(`migrating:${migration}`));
    Migrator.on("migrated", ({ migration }) => events.push(`migrated:${migration}`));
    Migrator.on("schemaDumped", ({ path }) => events.push(`dumped:${path}`));

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    await migrator.run();
    await migrator.dumpSchema(dumpPath);

    const dump = await Bun.file(dumpPath).text();
    expect(events).toContain(`migrating:tests/temp_migrations/${fileName}`);
    expect(events).toContain(`migrated:tests/temp_migrations/${fileName}`);
    expect(events).toContain(`dumped:${dumpPath}`);
    expect(dump).toContain("CREATE TABLE");
    expect(dump).toContain("event_test_table");

    Migrator.clearListeners();
    await unlink(filePath);
    await rm(dumpPath, { force: true });
  });
});

describe("Migrator multi-path support", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = setupTestDb();
    await mkdir(TEST_MIGRATIONS_DIR_A, { recursive: true });
    await mkdir(TEST_MIGRATIONS_DIR_B, { recursive: true });
  });

  afterAll(async () => {
    for (const dir of [TEST_MIGRATIONS_DIR_A, TEST_MIGRATIONS_DIR_B, TEST_MIGRATIONS_DIR_C, TEST_MIGRATIONS_DIR_D]) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("runs migrations from multiple configured folders", async () => {
    await Bun.write(
      join(TEST_MIGRATIONS_DIR_A, "20260401000000_create_alpha_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateAlphaTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("alpha_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("alpha_table");
  }
}`
    );

    await Bun.write(
      join(TEST_MIGRATIONS_DIR_B, "20260402000000_create_beta_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateBetaTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("beta_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("beta_table");
  }
}`
    );

    const migrator = new Migrator(connection, [TEST_MIGRATIONS_DIR_A, TEST_MIGRATIONS_DIR_B]);
    await migrator.run();

    expect(await Schema.hasTable("alpha_table")).toBe(true);
    expect(await Schema.hasTable("beta_table")).toBe(true);

    const status = await migrator.status();
    expect(status.filter((row) => row.status === "Ran").length).toBeGreaterThanOrEqual(2);
  });

  test("supports modular landlord and tenant migration path arrays", async () => {
    await mkdir(TEST_MIGRATIONS_DIR_C, { recursive: true });
    await mkdir(TEST_MIGRATIONS_DIR_D, { recursive: true });

    await Bun.write(
      join(TEST_MIGRATIONS_DIR_C, "20260403000000_create_landlord_settings_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateLandlordSettingsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("landlord_settings", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("landlord_settings");
  }
}`
    );

    await Bun.write(
      join(TEST_MIGRATIONS_DIR_D, "20260404000000_create_tenant_notes_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateTenantNotesTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("tenant_notes", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("tenant_notes");
  }
}`
    );

    const landlordMigrator = new Migrator(connection, [TEST_MIGRATIONS_DIR_C, TEST_MIGRATIONS_DIR_A]);
    const tenantMigrator = new Migrator(connection, [TEST_MIGRATIONS_DIR_D, TEST_MIGRATIONS_DIR_B]);

    await landlordMigrator.run();
    await tenantMigrator.run();

    expect(await Schema.hasTable("landlord_settings")).toBe(true);
    expect(await Schema.hasTable("tenant_notes")).toBe(true);
  });
});
