import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { configureBunny, Connection, ConnectionManager, DB } from "../src/index.js";

const TENANT_MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_bcf_tenant_schema_migrations");

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;

async function setupMigrationFile(): Promise<void> {
  await mkdir(TENANT_MIGRATIONS_DIR, { recursive: true });
}

describe.serial("configureBunny: tenant schema auto-create", () => {
  afterEach(async () => {
    await rm(TENANT_MIGRATIONS_DIR, { recursive: true, force: true });
    await ConnectionManager.closeAll();
  });

  runIfPostgres("creates missing tenant schema before running migrations", async () => {
    await setupMigrationFile();

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tenantSchema = `bcf_tenant_${suffix}`;

    const adminConn = new Connection({ url: postgresUrl! });

    try {
      // Sanity: schema does not exist yet
      const beforeRows = await adminConn.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
        [tenantSchema]
      );
      expect(beforeRows.length).toBe(0);

      const bunny = configureBunny({
        connection: { url: postgresUrl! },
        migrations: {
          tenant: TENANT_MIGRATIONS_DIR,
          createIfMissing: { schema: true },
        },
        tenancy: {
          resolveTenant: (tenantId) => ({
            strategy: "schema",
            name: `bcf-tenant-${tenantId}`,
            schema: tenantSchema,
            mode: "qualify",
          }),
        },
      });

      await DB.tenant(tenantId(), () => bunny.migrate("tenant"));

      // Schema now exists — createIfMissing kicked in before running migrations
      const afterRows = await adminConn.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
        [tenantSchema]
      );
      expect(afterRows.length).toBe(1);
    } finally {
      await adminConn.run(`DROP SCHEMA IF EXISTS "${tenantSchema}" CASCADE`);
      await adminConn.close();
    }
  });
});

function tenantId(): string {
  return "acme";
}

describe.serial("configureBunny: tenant schema idempotent", () => {
  afterEach(async () => {
    await rm(TENANT_MIGRATIONS_DIR, { recursive: true, force: true });
    await ConnectionManager.closeAll();
  });

  runIfPostgres("does not error when tenant schema already exists", async () => {
    await setupMigrationFile();

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tenantSchema = `bcf_tenant_${suffix}`;

    const adminConn = new Connection({ url: postgresUrl! });

    try {
      await adminConn.run(`CREATE SCHEMA "${tenantSchema}"`);

      const bunny = configureBunny({
        connection: { url: postgresUrl! },
        migrations: {
          tenant: TENANT_MIGRATIONS_DIR,
          createIfMissing: { schema: true },
        },
        tenancy: {
          resolveTenant: () => ({
            strategy: "schema",
            name: `bcf-tenant-existing-${suffix}`,
            schema: tenantSchema,
            mode: "qualify",
          }),
        },
      });

      await DB.tenant("acme", () => bunny.migrate("tenant"));

      const rows = await adminConn.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
        [tenantSchema]
      );
      expect(rows.length).toBe(1);
    } finally {
      await adminConn.run(`DROP SCHEMA IF EXISTS "${tenantSchema}" CASCADE`);
      await adminConn.close();
    }
  });
});
