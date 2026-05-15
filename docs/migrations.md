# Migrations

Migrations are versioned, ordered scripts that change your database schema. They go beside your code in git, run in lockstep with deploys, and roll back cleanly when something goes wrong. Bunny's migrator handles ordering, batching, locking, multi-tenant fan-out, and (optionally) auto-creates missing databases and schemas before running.

```ts
import { Migration, Migrator, Schema } from "@bunnykit/orm";
```

See [Schema Builder](./schema-builder.md) for the full vocabulary you use inside migration bodies.

## Anatomy of a migration

A migration is a class extending `Migration` with `up()` and `down()` methods. `up()` applies the change; `down()` reverses it. Both are async.

```ts
// database/migrations/20260101000000_create_users_table.ts
import { Migration, Schema } from "@bunnykit/orm";

export default class CreateUsersTable extends Migration {
  async up() {
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").unique();
      table.timestamps();
    });
  }

  async down() {
    await Schema.dropIfExists("users");
  }
}
```

Scaffold a new file with the CLI:

```bash
bunx bunny migrate:make CreateUsersTable
# → ./database/migrations/20260101000000_create_users_table.ts

bunx bunny migrate:make AddBioToUsers ./database/migrations
```

The timestamp prefix dictates run order, so always create new migrations via the CLI rather than hand-writing the filename.

## CLI commands

| Command | What it does |
|---|---|
| `bunny migrate:make <Name> [dir]` | Scaffold a new migration file. |
| `bunny migrate` | Run all pending migrations. |
| `bunny migrate:rollback` | Reverse the last batch. |
| `bunny migrate:reset` | Roll back every migration. |
| `bunny migrate:refresh` | `reset` + `migrate`. |
| `bunny migrate:fresh` | Drop every table + `migrate`. |
| `bunny migrate:status` | Tabular report of ran / pending migrations. |
| `bunny schema:dump <path>` | Dump current schema to a SQL file. |
| `bunny schema:squash <path>` | Dump schema *and* mark configured migrations as ran. |

Each command honors `migrationsPath` (single path) or `migrations.landlord` / `migrations.tenant` (grouped) from `bunny.config.ts`. See [Configuration](./configuration.md#migrationspath-vs-migrations).

## Batches and `migrations` table

Bunny records every applied migration in a `migrations` table (auto-created on first run). The table tracks:

- `migration` — the file name.
- `tenant` — the tenant id, or `null` for landlord migrations.
- `checksum` — used to detect file content drift.
- `batch` — incremented per `migrate` run.

`rollback` reverses one batch at a time. If your last `migrate` ran three new migrations, the next `rollback` reverses all three together.

## Auto-create database and schema

When the target database or schema does not exist yet, the migrator can create them automatically:

```ts
// bunny.config.ts
export default {
  connection: { url: process.env.DATABASE_URL! },
  migrations: {
    landlord: "./database/migrations",
    tenant: "./database/tenant-migrations",
    createIfMissing: { database: true, schema: true },
  },
};
```

Driver behavior:

- **Postgres** — connects to the `postgres` admin database, checks `pg_database`, runs `CREATE DATABASE` if missing. Schemas use `CREATE SCHEMA IF NOT EXISTS`.
- **MySQL** — `CREATE DATABASE IF NOT EXISTS` via the `mysql` admin database. No schemas.
- **SQLite** — the file is created by Bun on connect. Both flags are no-ops.

The shortcut `createIfMissing: true` enables both. For granular control use the object form. Idempotent — existing targets are left alone.

Inside `DB.tenant()`, the migrator picks up the tenant's qualified connection automatically, so a missing tenant schema is created before tenant migrations run:

```ts
await DB.tenant("acme", () => bunny.migrate("tenant"));
// → creates schema "tenant_acme" if absent, then runs tenant migrations under it
```

## Multi-tenant scopes

For apps with separate landlord and tenant migrations, group them:

```ts
// bunny.config.ts
export default {
  connection: { url: process.env.LANDLORD_DATABASE_URL! },
  migrations: {
    landlord: ["./database/landlord-migrations", "./modules/billing/migrations"],
    tenant:   ["./database/tenant-migrations",  "./modules/tenant-features/migrations"],
    createIfMissing: { database: true, schema: true },
  },
  tenancy: {
    resolveTenant: async (tenantId) => ({
      strategy: "database",
      name: `tenant:${tenantId}`,
      config: await getTenantConnectionConfig(tenantId),
    }),
    listTenants: async () => await getAllTenantIds(),
  },
};
```

With grouped migrations, `bunny migrate` runs landlord migrations first, then tenant migrations for every tenant returned by `listTenants()`. Rollbacks run in reverse — tenants first, then landlord.

Target individual scopes from the CLI:

```bash
bunny migrate                       # default: landlord then all tenants
bunny migrate --landlord
bunny migrate --tenants
bunny migrate --tenant acme
bunny migrate:rollback --tenant acme
bunny migrate:refresh --tenant acme
bunny migrate:fresh   --tenant acme
bunny migrate:status  --tenant acme
```

See [Configuration — Tenancy](./configuration.md#tenancy) for resolver setup.

## Programmatic use

### `configureBunny()` facade (recommended)

```ts
import { configureBunny } from "@bunnykit/orm";
import config from "../bunny.config";

const bunny = configureBunny(config);

await bunny.migrate();              // landlord
await bunny.migrate("tenant");      // tenant scope
await bunny.migrate("landlord", { createIfMissing: true });
await bunny.rollback(2);
await bunny.fresh();
```

See [Library Usage](./library-usage.md) for the full facade reference.

### `Migrator` directly

```ts
import { Migrator } from "@bunnykit/orm";

const migrator = new Migrator(connection, "./database/migrations");

await migrator.run();
await migrator.rollback(2);
await migrator.reset();
await migrator.refresh();
await migrator.fresh();
const status = await migrator.status();

await migrator.dumpSchema("./database/schema.sql");
await migrator.squash("./database/schema.sql");
```

`squash()` writes the schema dump and marks the configured migration files as already ran — useful for collapsing dozens of historical migrations into a single baseline.

## Migration events

```ts
import { Migrator } from "@bunnykit/orm";

Migrator.on("migrating", ({ migration, batch }) => {
  console.log(`Starting ${migration} (batch ${batch})`);
});
Migrator.on("migrated", ({ migration }) => {
  console.log(`Finished ${migration}`);
});
```

Events: `migrating`, `migrated`, `rollingBack`, `rolledBack`, `schemaDumped`, `schemaSquashed`.

Use these to wire up structured logging, Slack notifications on production migrations, or CI checks.

## Locking

Migrations acquire an advisory lock so concurrent deploys don't double-apply. The lock is released on completion or process exit. If you need to override the lock timeout for slow migrations, pass it via `MigratorOptions`:

```ts
new Migrator(connection, path, undefined, {}, {
  lock: true,
  lockTimeoutMs: 60_000,
});
```

Set `lock: false` only in development — never on production deploys.

## Auto type generation

If `typesOutDir` is set in your config, attribute interface declarations are regenerated automatically after every `migrate` and `migrate:rollback`. With `modelsPath`, Bunny writes a `types/` directory beside each model root:

```bash
bunx bunny migrate
# → Migrated: 20260101000000_create_users_table.ts
# → Regenerated types in ./src/models/types
```

See [Type Generation](./type-generation.md) for what is emitted and how IntelliSense picks it up.

## Common pitfalls

- **Editing a migration after it has run.** Bunny stores a checksum per migration. Changing a file's contents after it has been applied breaks the assumption that `up()` already produced the recorded schema. Add a new migration instead.
- **Missing `down()`.** Tools and dev workflows assume `down()` is the inverse of `up()`. Skipping it makes `rollback` unsafe. If a change is truly irreversible, throw with a clear message inside `down()`.
- **Non-idempotent `up()`.** If `up()` calls `Schema.table()` to add a column that already exists (e.g. from a fresh dump-and-reload), the migration fails. Use `Schema.hasColumn()` guards in long-running projects.
- **Running migrations without `createIfMissing` on a fresh DB.** You'll see "database does not exist" / "schema does not exist" errors. Enable `createIfMissing` or create the target manually first.
- **`migrate:fresh` in production.** This drops every table. Lock it down to dev / staging — e.g. guard the CLI invocation with `NODE_ENV !== "production"`.

## Where to next

- [Schema Builder](./schema-builder.md) — the full set of column, index, and foreign key helpers you use inside `up()`.
- [Configuration](./configuration.md#migrationspath-vs-migrations) — how `migrationsPath` and `migrations.{landlord,tenant}` are resolved.
- [Library Usage](./library-usage.md) — running migrations from app code with the `configureBunny()` facade.
- [Type Generation](./type-generation.md) — what auto-regenerates after each migration.
