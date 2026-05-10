import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { ConnectionManager, Model, Schema, Seeder, SeederRunner, TenantContext, factory } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class SeedUser extends Model {
  static table = "seed_users";
  static timestamps = false;
  static fillable = ["name", "email", "role"];
}

describe("Seeders and factories", () => {
  test("factory makes raw attributes, unsaved models, and created records", async () => {
    setupTestDb();
    await Schema.create("seed_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email");
      table.string("role").nullable();
    });

    const users = factory(SeedUser, (sequence) => ({
      name: `User ${sequence}`,
      email: `user${sequence}@example.test`,
    })).state({ role: "member" });

    const raw = users.raw();
    const made = users.count(2).make();
    const created = await users.count(2).create({ role: "admin" });

    expect(raw).toMatchObject({ name: "User 1", role: "member" });
    expect(Array.isArray(made)).toBe(true);
    expect((made as SeedUser[])[0].getAttribute("email")).toBe("user1@example.test");
    expect((created as SeedUser[])[0].getAttribute("id")).toBe(1);
    expect(await SeedUser.query().count()).toBe(2);
  });

  test("SeederRunner runs seeder classes and seeder paths", async () => {
    setupTestDb();
    await Schema.create("seed_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email");
    });

    class InlineSeeder extends Seeder {
      async run(): Promise<void> {
        await SeedUser.create({ name: "Inline", email: "inline@example.test" });
      }
    }

    const seedDir = join(process.cwd(), "tests", "temp_seeders");
    await rm(seedDir, { recursive: true, force: true });
    await mkdir(seedDir, { recursive: true });
    await Bun.write(
      join(seedDir, "UserSeeder.ts"),
      `
import { Seeder, Model } from "../../src/index.js";
class PathSeedUser extends Model {
  static table = "seed_users";
  static timestamps = false;
  static fillable = ["name", "email"];
}
export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await PathSeedUser.create({ name: "Path", email: "path@example.test" });
  }
}`
    );

    const runner = new SeederRunner();
    await runner.run([InlineSeeder]);
    await runner.runPaths(seedDir);

    const names = (await SeedUser.orderBy("id").get()).map((user) => user.getAttribute("name"));
    expect(names).toEqual(["Inline", "Path"]);

    await rm(seedDir, { recursive: true, force: true });
  });

  test("SeederRunner can run one seeder target by name or file", async () => {
    setupTestDb();
    await Schema.create("seed_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email");
    });

    const seedDir = join(process.cwd(), "tests", "temp_named_seeders");
    await rm(seedDir, { recursive: true, force: true });
    await mkdir(seedDir, { recursive: true });
    const firstPath = join(seedDir, "FirstSeeder.ts");
    const secondPath = join(seedDir, "SecondSeeder.ts");

    await Bun.write(
      firstPath,
      `
import { Seeder, Model } from "../../src/index.js";
class NamedSeedUser extends Model {
  static table = "seed_users";
  static timestamps = false;
  static fillable = ["name", "email"];
}
export default class FirstSeeder extends Seeder {
  async run(): Promise<void> {
    await NamedSeedUser.create({ name: "First", email: "first@example.test" });
  }
}`
    );
    await Bun.write(
      secondPath,
      `
import { Seeder, Model } from "../../src/index.js";
class NamedSeedUser extends Model {
  static table = "seed_users";
  static timestamps = false;
  static fillable = ["name", "email"];
}
export default class SecondSeeder extends Seeder {
  async run(): Promise<void> {
    await NamedSeedUser.create({ name: "Second", email: "second@example.test" });
  }
}`
    );

    const runner = new SeederRunner();
    await runner.runTarget("SecondSeeder", seedDir);

    expect((await SeedUser.all()).map((user) => user.getAttribute("name"))).toEqual(["Second"]);

    await runner.runTarget(firstPath, seedDir);

    expect((await SeedUser.orderBy("id").get()).map((user) => user.getAttribute("name"))).toEqual(["Second", "First"]);

    await rm(seedDir, { recursive: true, force: true });
  });

  test("SeederRunner uses the active tenant connection when running inside TenantContext", async () => {
    setupTestDb();

    const tenantDb = join(process.cwd(), "tests", "temp_tenant_seed.sqlite");
    await rm(tenantDb, { force: true });

    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `tenant:${tenantId}`,
      config: { url: `sqlite://${tenantDb}` },
    }));

    await TenantContext.run("acme", async () => {
      await Schema.create("seed_users", (table) => {
        table.increments("id");
        table.string("name");
        table.string("email");
      });

      class TenantSeeder extends Seeder {
        async run(): Promise<void> {
          await SeedUser.create({ name: "Tenant", email: "tenant@example.test" });
        }
      }

      const runner = new SeederRunner();
      await runner.run([TenantSeeder]);

      expect((await SeedUser.all()).map((user) => user.getAttribute("name"))).toEqual(["Tenant"]);
    });

    await ConnectionManager.closeAll();
    await rm(tenantDb, { force: true });
  });
});
