import { afterEach, describe, expect, test } from "bun:test";
import { Connection, ConnectionManager, Model, Schema, TenantContext } from "../src/index.js";

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

      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "rls",
        name: "pg-rls:main",
        tenantId,
        setting: "app.tenant_id",
      }));

      const acme = await TenantContext.run("acme", () => PgRlsItem.all());
      const beta = await TenantContext.run("beta", () => PgRlsItem.all());

      expect(acme.map((row) => row.getAttribute("name"))).toEqual(["Acme Item"]);
      expect(beta.map((row) => row.getAttribute("name"))).toEqual(["Beta Item"]);
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(table)} CASCADE`);
      await connection.close();
    }
  });
});
