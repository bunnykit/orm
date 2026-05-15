import { expect, test, describe, beforeAll } from "bun:test";
import { DB, Model, Schema, ConnectionManager, Connection, TenantContext } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class DbUser extends Model.define<{ id: number; name: string; active: boolean }>("db_users") {}

describe("DB facade", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("db_users", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active");
      table.timestamps();
    });
    await DbUser.create({ name: "Alice", active: true });
    await DbUser.create({ name: "Bob", active: false });
    await DbUser.create({ name: "Carol", active: true });
  });

  test("DB.table().get() returns rows without model", async () => {
    const rows = await DB.table("db_users").where("active", true).get();
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBeDefined();
  });

  test("DB.table().update()", async () => {
    await DB.table("db_users").where("name", "Bob").update({ active: true });
    const bob = await DB.table("db_users").where("name", "Bob").first();
    expect(bob.active).toBeTruthy();
  });

  test("DB.table().count()", async () => {
    const count = await DB.table("db_users").count();
    expect(count).toBe(3);
  });

  test("DB.raw() executes arbitrary SQL", async () => {
    const rows = await DB.raw("SELECT COUNT(*) as c FROM db_users");
    expect(Number(rows[0].c)).toBe(3);
  });

  test("DB.connection(name) targets registered connection", async () => {
    const alt = new Connection({ url: "sqlite://:memory:" });
    ConnectionManager.add("alt", alt);

    await alt.query("CREATE TABLE alt_items (id INTEGER PRIMARY KEY, label TEXT)");
    await alt.query("INSERT INTO alt_items (label) VALUES ('x'), ('y')");

    const rows = await DB.connection("alt").table("alt_items").get();
    expect(rows.length).toBe(2);
  });

  test("DB.connection() throws for unregistered name", () => {
    expect(() => DB.connection("missing")).toThrow();
  });

  test("DB.tenant() wraps TenantContext.run", async () => {
    ConnectionManager.setTenantResolver(async (tenantId) => ({
      strategy: "schema",
      name: `tenant:${tenantId}`,
      schema: `tenant_${tenantId}`,
      mode: "qualify",
      connection: ConnectionManager.getDefault()!,
    }));

    let ranInside = false;
    await DB.tenant("acme", async () => {
      ranInside = true;
      const rows = await DB.table("db_users").get();
      expect(rows.length).toBeGreaterThan(0);
    });
    expect(ranInside).toBe(true);
  });

  test("context switching: outside has no tenant", async () => {
    expect(TenantContext.current()).toBeUndefined();

    await DB.tenant("acme", async () => {
      expect(TenantContext.current()?.tenantId).toBe("acme");
    });

    expect(TenantContext.current()).toBeUndefined();
  });

  test("context switching: nested DB.tenant() overrides outer", async () => {
    const observed: string[] = [];

    await DB.tenant("acme", async () => {
      observed.push(TenantContext.current()!.tenantId);

      await DB.tenant("globex", async () => {
        observed.push(TenantContext.current()!.tenantId);

        await DB.tenant("initech", async () => {
          observed.push(TenantContext.current()!.tenantId);
        });

        observed.push(TenantContext.current()!.tenantId);
      });

      observed.push(TenantContext.current()!.tenantId);
    });

    expect(observed).toEqual(["acme", "globex", "initech", "globex", "acme"]);
    expect(TenantContext.current()).toBeUndefined();
  });

  test("context switching: parallel tenants do not bleed", async () => {
    const results = await Promise.all([
      DB.tenant("a", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return TenantContext.current()?.tenantId;
      }),
      DB.tenant("b", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return TenantContext.current()?.tenantId;
      }),
      DB.tenant("c", async () => TenantContext.current()?.tenantId),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(TenantContext.current()).toBeUndefined();
  });
});
