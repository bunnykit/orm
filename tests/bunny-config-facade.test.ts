import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { configureBunny, Schema } from "../src/index.js";

const MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_bcf_migrations");
const TENANT_MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_bcf_tenant_migrations");
const SEEDERS_DIR = join(process.cwd(), "tests", "temp_bcf_seeders");

async function writeMigration(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body, "utf-8");
}

describe("configureBunny facade", () => {
  beforeAll(async () => {
    await mkdir(MIGRATIONS_DIR, { recursive: true });
    await mkdir(TENANT_MIGRATIONS_DIR, { recursive: true });
    await mkdir(SEEDERS_DIR, { recursive: true });

    await writeMigration(
      MIGRATIONS_DIR,
      "20260101000000_create_widgets.ts",
      `import { Migration, Schema } from "../../src/index.js";
export default class CreateWidgets extends Migration {
  async up() {
    await Schema.create("bcf_widgets", (t) => {
      t.increments("id");
      t.string("name");
    });
  }
  async down() { await Schema.dropIfExists("bcf_widgets"); }
}
`
    );

    await writeMigration(
      TENANT_MIGRATIONS_DIR,
      "20260101000001_create_gadgets.ts",
      `import { Migration, Schema } from "../../src/index.js";
export default class CreateGadgets extends Migration {
  async up() {
    await Schema.create("bcf_gadgets", (t) => {
      t.increments("id");
      t.string("label");
    });
  }
  async down() { await Schema.dropIfExists("bcf_gadgets"); }
}
`
    );

    await writeFile(
      join(SEEDERS_DIR, "WidgetSeeder.ts"),
      `import { Seeder } from "../../src/index.js";
export default class WidgetSeeder extends Seeder {
  async run() {
    await this.connection.run("INSERT INTO bcf_widgets (name) VALUES ('seeded-a'), ('seeded-b')");
  }
}
`
    );
  });

  afterAll(async () => {
    await rm(MIGRATIONS_DIR, { recursive: true, force: true });
    await rm(TENANT_MIGRATIONS_DIR, { recursive: true, force: true });
    await rm(SEEDERS_DIR, { recursive: true, force: true });
  });

  test("migrate() runs landlord migrations from config.migrationsPath", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
      seedersPath: SEEDERS_DIR,
    });

    await bunny.migrate();

    expect(await Schema.hasTable("bcf_widgets")).toBe(true);
    expect(await Schema.hasTable("migrations")).toBe(true);
  });

  test("migrator() exposes underlying instance", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    const migrator = bunny.migrator();
    await migrator.run();
    const status = await migrator.status();
    expect(status.length).toBeGreaterThan(0);
  });

  test("seed() runs seeders from config.seedersPath", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
      seedersPath: SEEDERS_DIR,
    });

    await bunny.migrate();
    await bunny.seed();

    const rows = await bunny.connection.query("SELECT COUNT(*) as c FROM bcf_widgets");
    expect(Number(rows[0].c)).toBe(2);
  });

  test("seed() throws when seedersPath missing", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });
    expect(bunny.seed()).rejects.toThrow(/seedersPath/);
  });

  test("rollback() reverses last batch", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    await bunny.migrate();
    expect(await Schema.hasTable("bcf_widgets")).toBe(true);

    await bunny.rollback();
    expect(await Schema.hasTable("bcf_widgets")).toBe(false);
  });

  test("fresh() drops all + re-runs", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    await bunny.migrate();
    await bunny.connection.run("INSERT INTO bcf_widgets (name) VALUES ('keep-me')");

    await bunny.fresh();

    const rows = await bunny.connection.query("SELECT COUNT(*) as c FROM bcf_widgets");
    expect(Number(rows[0].c)).toBe(0);
  });

  test("migrate('tenant') uses config.migrations.tenant path", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrations: {
        landlord: MIGRATIONS_DIR,
        tenant: TENANT_MIGRATIONS_DIR,
      },
    });

    await bunny.migrate("landlord");
    await bunny.migrate("tenant");

    expect(await Schema.hasTable("bcf_widgets")).toBe(true);
    expect(await Schema.hasTable("bcf_gadgets")).toBe(true);
  });

  test("migrate() throws when scope path not configured", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrations: { landlord: MIGRATIONS_DIR },
    });
    expect(bunny.migrate("tenant")).rejects.toThrow(/tenant/);
  });

  test("overrides pass through to Migrator", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    const migrator = bunny.migrator("landlord", { lock: false });
    expect(migrator).toBeDefined();
    await migrator.run();
  });

  test("createIfMissing is a no-op for SQLite (no error)", async () => {
    const bunny = configureBunny({
      connection: { url: "sqlite://:memory:" },
      migrations: {
        landlord: MIGRATIONS_DIR,
        createIfMissing: { database: true, schema: true },
      },
    });

    await bunny.migrate();
    expect(await Schema.hasTable("bcf_widgets")).toBe(true);
  });

  test("createIfMissing creates SQLite file on disk if missing", async () => {
    const dbPath = join(process.cwd(), "tests", `temp_bcf_${Date.now()}.sqlite`);

    const bunny = configureBunny({
      connection: { url: `sqlite://${dbPath}` },
      migrations: {
        landlord: MIGRATIONS_DIR,
        createIfMissing: true,
      },
    });

    try {
      await bunny.migrate();
      expect(await Schema.hasTable("bcf_widgets")).toBe(true);
      const file = Bun.file(dbPath);
      expect(await file.exists()).toBe(true);
    } finally {
      await bunny.connection.close();
      await rm(dbPath, { force: true });
    }
  });
});
