import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { Connection, ConnectionManager, Migrator, Model, Schema, TenantContext } from "../src/index.js";

class PgTenantUser extends Model {
  static table = "tenant_users";
  static timestamps = false;
}

class PgRlsItem extends Model {
  static table = "rls_items";
  static timestamps = false;
}

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test : test.skip;

describe("PostgreSQL tenant integration", () => {
  afterEach(async () => {
    await ConnectionManager.closeAll();
  });

  runIfPostgres("isolates schema tenants with search_path", async () => {
    const connection = new Connection({ url: postgresUrl! });
    Schema.setConnection(connection);
    ConnectionManager.setDefault(connection);

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const schemaA = `fluent_tenant_${suffix}_a`;
    const schemaB = `fluent_tenant_${suffix}_b`;
    const grammar = connection.getGrammar();

    try {
      await Schema.createSchema(schemaA);
      await Schema.createSchema(schemaB);
      for (const [schema, name] of [[schemaA, "Acme User"], [schemaB, "Beta User"]] as const) {
        await connection.run(`CREATE TABLE ${grammar.wrap(`${schema}.tenant_users`)} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
        await connection.run(`INSERT INTO ${grammar.wrap(`${schema}.tenant_users`)} (id, name) VALUES (1, $1)`, [name]);
      }

      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "schema",
        name: `pg-search-path:${tenantId}`,
        schema: tenantId === "acme" ? schemaA : schemaB,
        mode: "search_path",
      }));

      const acme = await TenantContext.run("acme", () => PgTenantUser.find(1));
      const beta = await TenantContext.run("beta", () => PgTenantUser.find(1));

      expect(acme?.getAttribute("name")).toBe("Acme User");
      expect(beta?.getAttribute("name")).toBe("Beta User");
    } finally {
      await connection.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schemaA)} CASCADE`);
      await connection.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schemaB)} CASCADE`);
      await connection.close();
    }
  });

  runIfPostgres("isolates RLS tenants with SET LOCAL tenant setting", async () => {
    const connection = new Connection({ url: postgresUrl! });
    Schema.setConnection(connection);
    ConnectionManager.setDefault(connection);

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const table = `fluent_rls_items_${suffix}`;
    const role = `fluent_rls_role_${suffix}`;
    PgRlsItem.table = table;
    const grammar = connection.getGrammar();

    try {
      await connection.run(`CREATE TABLE ${grammar.wrap(table)} (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL)`);
      await connection.run(`INSERT INTO ${grammar.wrap(table)} (id, tenant_id, name) VALUES (1, 'acme', 'Acme Item'), (2, 'beta', 'Beta Item')`);
      await connection.run(`ALTER TABLE ${grammar.wrap(table)} ENABLE ROW LEVEL SECURITY`);
      await connection.run(`ALTER TABLE ${grammar.wrap(table)} FORCE ROW LEVEL SECURITY`);
      await connection.run(
        `CREATE POLICY ${grammar.wrap(`${table}_tenant_policy`)} ON ${grammar.wrap(table)} USING (tenant_id = current_setting('app.tenant_id', true))`
      );
      await connection.run(`CREATE ROLE ${grammar.wrap(role)}`);
      await connection.run(`GRANT SELECT ON ${grammar.wrap(table)} TO ${grammar.wrap(role)}`);

      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "rls",
        name: "pg-rls:main",
        tenantId,
        setting: "app.tenant_id",
        role,
      }));

      const acme = await TenantContext.run("acme", () => PgRlsItem.all());
      const beta = await TenantContext.run("beta", () => PgRlsItem.all());

      expect(acme.map((row) => row.getAttribute("name"))).toEqual(["Acme Item"]);
      expect(beta.map((row) => row.getAttribute("name"))).toEqual(["Beta Item"]);
    } finally {
      await connection.run("RESET ROLE").catch(() => null);
      await connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(table)} CASCADE`);
      await connection.run(`DROP ROLE IF EXISTS ${grammar.wrap(role)}`);
      await connection.close();
    }
  });

  runIfPostgres("runs migration batches through Bun PostgreSQL transactions", async () => {
    const connection = new Connection({ url: postgresUrl! });
    Schema.setConnection(connection);
    ConnectionManager.setDefault(connection);

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const schema = `fluent_migration_${suffix}`;
    const table = `migration_items_${suffix}`;
    const directory = join(process.cwd(), "tests", `temp_postgres_migrations_${suffix}`);
    const fileName = `20260501000000_create_postgres_migration_items_${suffix}.ts`;
    const grammar = connection.getGrammar();

    try {
      await mkdir(directory, { recursive: true });
      await Schema.createSchema(schema);
      await Bun.write(
        join(directory, fileName),
        `
import { Migration, Schema } from "../../src/index.js";
export default class CreatePostgresMigrationItems extends Migration {
  async up(): Promise<void> {
    await Schema.create("${table}", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("${table}");
  }
}`
      );

      const migrator = new Migrator(connection.withSchema(schema), directory);
      await migrator.run();

      const rows = await connection.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2",
        [schema, table]
      );
      expect(rows).toHaveLength(1);
    } finally {
      await connection.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schema)} CASCADE`);
      await connection.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  runIfPostgres("supports manual transactions on pooled PostgreSQL connections", async () => {
    const connection = new Connection({ url: postgresUrl! });
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const table = `fluent_manual_tx_${suffix}`;
    const grammar = connection.getGrammar();

    try {
      await connection.run(`CREATE TABLE ${grammar.wrap(table)} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
      await connection.beginTransaction();
      await connection.run(`INSERT INTO ${grammar.wrap(table)} (id, name) VALUES (1, 'rollback')`);
      await connection.rollback();

      const rows = await connection.query(`SELECT * FROM ${grammar.wrap(table)}`);
      expect(rows).toHaveLength(0);
    } finally {
      if (connection.isInTransaction()) {
        await connection.rollback().catch(() => null);
      }
      await connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(table)} CASCADE`);
      await connection.close();
    }
  });
});
