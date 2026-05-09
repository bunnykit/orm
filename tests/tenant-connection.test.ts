import { afterEach, describe, expect, test } from "bun:test";
import { configureBunny, Connection, ConnectionManager, Model, Schema, TenantContext } from "../src/index.js";

class TenantUser extends Model {
  static table = "tenant_users";
  static timestamps = false;
}

class LandlordTenant extends Model {
  static table = "tenants";
  static timestamps = false;
}

async function createTenantDb(label: string) {
  const connection = new Connection({ url: "sqlite://:memory:" });
  await connection.run("CREATE TABLE tenant_users (id INTEGER PRIMARY KEY, name TEXT)");
  await connection.run(`INSERT INTO tenant_users (id, name) VALUES (1, '${label} User')`);
  return connection;
}

describe("tenant connection switching", () => {
  afterEach(async () => {
    await ConnectionManager.closeAll();
  });

  test("resolves tenant connections dynamically inside TenantContext", async () => {
    const acme = await createTenantDb("Acme");
    const beta = await createTenantDb("Beta");
    let resolverCalls = 0;

    ConnectionManager.setTenantResolver((tenantId) => {
      resolverCalls++;
      return {
        strategy: "database",
        name: `tenant:${tenantId}`,
        config: { url: "sqlite://:memory:" },
      };
    });
    ConnectionManager.add("tenant:acme", acme);
    ConnectionManager.add("tenant:beta", beta);

    const acmeUser = await TenantContext.run("acme", () => TenantUser.find(1));
    const betaUser = await TenantContext.run("beta", () => TenantUser.find(1));

    expect(acmeUser?.getAttribute("name")).toBe("Acme User");
    expect(betaUser?.getAttribute("name")).toBe("Beta User");
    expect(resolverCalls).toBe(2);
  });

  test("keeps concurrent tenant contexts isolated", async () => {
    const acme = await createTenantDb("Acme");
    const beta = await createTenantDb("Beta");

    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `isolated:${tenantId}`,
      config: { url: "sqlite://:memory:" },
    }));
    ConnectionManager.add("isolated:acme", acme);
    ConnectionManager.add("isolated:beta", beta);

    const [left, right] = await Promise.all([
      TenantContext.run("acme", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return TenantUser.find(1);
      }),
      TenantContext.run("beta", () => TenantUser.find(1)),
    ]);

    expect(left?.getAttribute("name")).toBe("Acme User");
    expect(right?.getAttribute("name")).toBe("Beta User");
  });

  test("forTenant uses an already resolved tenant connection", async () => {
    const acme = await createTenantDb("Acme");
    ConnectionManager.setTenantResolver(() => ({
      strategy: "database",
      name: "cached:acme",
      config: { url: "sqlite://:memory:" },
    }));
    ConnectionManager.add("cached:acme", acme);
    await ConnectionManager.resolveTenant("acme");

    const user = await TenantUser.forTenant("acme").find(1);

    expect(user?.getAttribute("name")).toBe("Acme User");
  });

  test("loaded models save using their original tenant connection", async () => {
    const acme = await createTenantDb("Acme");
    const beta = await createTenantDb("Beta");
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `writeback:${tenantId}`,
      config: { url: "sqlite://:memory:" },
    }));
    ConnectionManager.add("writeback:acme", acme);
    ConnectionManager.add("writeback:beta", beta);

    const acmeUser = await TenantContext.run("acme", () => TenantUser.find(1));
    await TenantContext.run("beta", async () => {
      acmeUser!.setAttribute("name", "Acme Updated");
      await acmeUser!.save();
    });

    const acmeRows = await acme.query("SELECT name FROM tenant_users WHERE id = 1");
    const betaRows = await beta.query("SELECT name FROM tenant_users WHERE id = 1");

    expect(acmeRows[0].name).toBe("Acme Updated");
    expect(betaRows[0].name).toBe("Beta User");
  });

  test("Schema uses the active tenant connection", async () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    ConnectionManager.setTenantResolver(() => ({
      strategy: "database",
      name: "schema:tenant",
      config: { url: "sqlite://:memory:" },
    }));
    ConnectionManager.add("schema:tenant", connection);

    await TenantContext.run("tenant", async () => {
      await Schema.create("tenant_users", (table) => {
        table.increments("id");
        table.string("name");
      });
    });

    expect(await TenantContext.run("tenant", () => Schema.hasTable("tenant_users"))).toBe(true);
  });

  test("search_path schema mode can reuse the default connection", async () => {
    const connection = new Connection({ url: "postgres://user:pass@localhost:5432/app" });
    ConnectionManager.setDefault(connection);
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "schema",
      name: `search-path:${tenantId}`,
      schema: `tenant_${tenantId}`,
      mode: "search_path",
    }));

    const context = await ConnectionManager.resolveTenant("acme");

    expect(context.connection).toBe(connection);
    expect(context.schema).toBe("tenant_acme");
    expect(context.schemaMode).toBe("search_path");
    expect(context.connection.getSchema()).toBeUndefined();
  });

  test("RLS tenant resolution supports a custom PostgreSQL setting name", async () => {
    const connection = new Connection({ url: "postgres://user:pass@localhost:5432/app" });
    ConnectionManager.setDefault(connection);
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "rls",
      name: "rls:main",
      tenantId: `uuid-for-${tenantId}`,
      setting: "app.current_tenant_id",
    }));

    const context = await ConnectionManager.resolveTenant("acme");

    expect(context.connection).toBe(connection);
    expect(context.strategy).toBe("rls");
    expect(context.rlsTenantId).toBe("uuid-for-acme");
    expect(context.rlsSetting).toBe("app.current_tenant_id");
  });

  test("configureBunny registers the default connection and tenant resolver", async () => {
    const acme = await createTenantDb("Acme");
    const { connection } = configureBunny({
      connection: { url: "sqlite://:memory:" },
      tenancy: {
        resolveTenant: (tenantId) => ({
          strategy: "database",
          name: `configured:${tenantId}`,
          config: { url: "sqlite://:memory:" },
        }),
      },
    });
    ConnectionManager.add("configured:acme", acme);

    expect(Model.getConnection()).toBe(connection);
    expect(Schema.getConnection()).toBe(connection);

    const user = await TenantContext.run("acme", () => TenantUser.find(1));

    expect(user?.getAttribute("name")).toBe("Acme User");
  });

  test("resolves tenants from a landlord database and routes to multiple sqlite tenants", async () => {
    const landlord = new Connection({ url: "sqlite://:memory:" });
    await landlord.run("CREATE TABLE tenants (slug TEXT PRIMARY KEY, connection_name TEXT NOT NULL)");
    await landlord.run("INSERT INTO tenants (slug, connection_name) VALUES ('acme', 'tenant:acme'), ('beta', 'tenant:beta')");

    const acme = await createTenantDb("Acme");
    const beta = await createTenantDb("Beta");

    LandlordTenant.setConnection(landlord);
    ConnectionManager.add("landlord", landlord);
    configureBunny({
      connection: { url: "sqlite://:memory:" },
      tenancy: {
        resolveTenant: async (tenantSlug) => {
          const tenant = await LandlordTenant.where("slug", tenantSlug).first();
          if (!tenant) {
            throw new Error(`Unknown tenant: ${tenantSlug}`);
          }
          return {
            strategy: "database",
            name: tenant.getAttribute("connection_name"),
            config: { url: "sqlite://:memory:" },
          };
        },
      },
    });

    ConnectionManager.add("tenant:acme", acme);
    ConnectionManager.add("tenant:beta", beta);

    const [acmeUser, betaUser, landlordTenants] = await Promise.all([
      TenantContext.run("acme", () => TenantUser.find(1)),
      TenantContext.run("beta", () => TenantUser.find(1)),
      LandlordTenant.all(),
    ]);

    expect(acmeUser?.getAttribute("name")).toBe("Acme User");
    expect(betaUser?.getAttribute("name")).toBe("Beta User");
    expect(landlordTenants).toHaveLength(2);
    expect(landlordTenants.map((row) => row.getAttribute("slug")).sort()).toEqual(["acme", "beta"]);
  });
});
