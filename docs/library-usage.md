# Library Usage

You can run every CLI command from your own code — migrations, seeders, schema dumps, and tenant-aware operations. The fastest path is the `configureBunny()` facade, which reuses your `bunny.config.ts` so the CLI and your runtime stay in sync. Drop down to `Migrator` / `SeederRunner` / `Connection` directly when you need fine-grained control.

```ts
import { configureBunny, Connection, Migrator, SeederRunner, DB } from "@bunnykit/orm";
```

## `configureBunny()` facade

Call once at application startup. The function constructs a `Connection`, registers it as the default, wires up tenancy if configured, and returns a small object of helpers:

```ts
// src/app.ts
import { configureBunny } from "@bunnykit/orm";
import config from "../bunny.config";

const bunny = configureBunny(config);

bunny.config;        // the original BunnyConfig you passed in
bunny.connection;    // the constructed default Connection
```

### Migrations

```ts
await bunny.migrate();                                  // landlord scope (or single migrationsPath)
await bunny.migrate("tenant");                          // tenant scope
await bunny.migrate("landlord", { createIfMissing: true });  // override migrator options
await bunny.rollback();                                 // rollback last batch
await bunny.rollback(3);                                // rollback 3 batches
await bunny.rollback(1, "tenant");                      // rollback tenant scope
await bunny.fresh();                                    // drop + re-migrate
await bunny.fresh("tenant");                            // drop + re-migrate tenant scope
```

Need methods the shortcuts don't expose (`status`, `reset`, `refresh`, `dumpSchema`)? Grab the underlying `Migrator`:

```ts
const migrator = bunny.migrator("tenant");
const status = await migrator.status();
await migrator.refresh();
await migrator.dumpSchema("./database/schema.sql");
```

### Seeders

```ts
await bunny.seed();                                     // run config.seedersPath

// Or full SeederRunner API
const seeder = bunny.seeder();
await seeder.runFile("./database/seeders/UserSeeder.ts");
await seeder.runTarget("AdminSeeder", "./database/seeders");
```

### Tenant-aware programmatic ops

Inside `DB.tenant()`, the facade picks up the tenant's connection automatically — migrations and seeders run against the tenant's database or schema:

```ts
import { DB } from "@bunnykit/orm";

await DB.tenant("acme", async () => {
  await bunny.migrate("tenant");
  await bunny.seed();
});
```

Combined with `migrations.createIfMissing`, this is how you provision a brand-new tenant in one call:

```ts
async function onboardTenant(tenantId: string) {
  await DB.tenant(tenantId, async () => {
    await bunny.migrate("tenant");  // creates schema, runs migrations, generates types
    await bunny.seed();             // populates defaults
  });
}
```

## Bare-metal usage

For one-off scripts, embedded use cases, or environments where you don't want to depend on `bunny.config.ts`, drop straight to the building blocks.

### Manual connection + migrator

```ts
import { Connection, Migrator, MigrationCreator } from "@bunnykit/orm";

const connection = new Connection({ url: "sqlite://app.db" });

// Scaffold a new file
const creator = new MigrationCreator();
const path = await creator.create("CreateOrdersTable", "./database/migrations");

// Run all pending migrations
const migrator = new Migrator(connection, "./database/migrations");
await migrator.run();

// Rollback
await migrator.rollback();
```

`Migrator` accepts more arguments for type generation and options:

```ts
new Migrator(
  connection,
  "./database/migrations",
  "./src/types",              // typesOutDir
  { declarations: true },     // TypeGeneratorOptions
  { createIfMissing: true, lock: true },
);
```

### Manual seeders

```ts
import { Connection, SeederRunner } from "@bunnykit/orm";
import UserSeeder from "./database/seeders/UserSeeder";

const connection = new Connection({ url: "sqlite://app.db" });
const runner = new SeederRunner(connection);

await runner.run(UserSeeder);
await runner.runPaths("./database/seeders");
await runner.runFile("./database/seeders/UserSeeder.ts");
await runner.runTarget("UserSeeder", "./database/seeders");
```

Seeder runs are atomic — if any seeder throws, the entire run is rolled back.

### Connection-only

When you just need a database handle, skip the facade entirely:

```ts
import { Connection, Model, Schema } from "@bunnykit/orm";

const connection = new Connection({ url: "sqlite://:memory:" });
Model.setConnection(connection);
Schema.setConnection(connection);
```

You're then free to use models, the schema builder, and `DB.table(...)` without `configureBunny()`.

## Embedding in scripts

A common pattern is a maintenance script that runs outside the app process — say a cron job that archives old data:

```ts
// scripts/archive-old-orders.ts
import { configureBunny, DB } from "@bunnykit/orm";
import config from "../bunny.config";

const bunny = configureBunny(config);

const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

const archived = await DB.table("orders")
  .where("status", "completed")
  .where("created_at", "<", cutoff.toISOString())
  .update({ archived_at: new Date().toISOString() });

console.log(`Archived ${archived} orders.`);
await bunny.connection.close();
```

Always close the connection at the end of a script (`bunny.connection.close()`) — otherwise the process hangs waiting for the pool to drain.

## Where to next

- [Configuration](./configuration.md) — every `BunnyConfig` field the facade reads.
- [Migrations](./migrations.md) — `Migrator` API, multi-tenant scopes, schema dumps.
- [Seeders](./seeders.md) — writing reusable seeders and factories.
- [Query Builder — `DB` facade](./query-builder.md#the-db-facade) — `DB.table`, `DB.tenant`, `DB.raw`.
