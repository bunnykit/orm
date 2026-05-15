# Configuration

Bunny is configured through a single `BunnyConfig` object — typically exported from `bunny.config.ts` at your project root. The same file is read by the CLI (`bunx bunny migrate`, etc.) and by the `configureBunny()` runtime facade your application calls at startup.

## The minimum config

```ts
// bunny.config.ts
export default {
  connection: { url: "sqlite://app.db" },
  migrationsPath: "./database/migrations",
};
```

That is enough for a single-database app with file-based migrations. Everything else is optional.

## A complete config

```ts
// bunny.config.ts
import type { BunnyConfig } from "@bunnykit/orm";

const config: BunnyConfig = {
  connection: {
    url: process.env.DATABASE_URL!,
  },

  // Migrations
  migrations: {
    landlord: "./database/landlord-migrations",
    tenant: "./database/tenant-migrations",
    createIfMissing: { database: true, schema: true },
  },

  // Seeders
  seedersPath: "./database/seeders",

  // Tenancy
  tenancy: {
    resolveTenant: async (tenantId) => ({
      strategy: "schema",
      name: `tenant:${tenantId}`,
      schema: `tenant_${tenantId}`,
      mode: "qualify",
    }),
    listTenants: async () => ["acme", "globex", "initech"],
  },

  // Models (used by type generation and the REPL)
  modelsPath: {
    landlord: "./src/models/landlord",
    tenant: "./src/models/tenant",
  },

  // Type generation overrides
  typeDeclarationImportPrefix: "$models",
  typeDeclarationSingularModels: true,

  // Diagnostics
  logQueries: false,
};

export default config;
```

## `connection`

Required. Two equivalent shapes are supported.

### URL form

```ts
connection: { url: "postgres://user:pass@localhost:5432/mydb" }
connection: { url: "mysql://user:pass@localhost:3306/mydb" }
connection: { url: "sqlite://./app.db" }
connection: { url: "sqlite://:memory:" }
```

You can also pin a Postgres schema and tune the connection pool from the URL form:

```ts
connection: {
  url: "postgres://localhost/mydb",
  schema: "app",   // default search_path / qualifier
  max: 20,         // pool size
}
```

### Driver form

Useful when secrets come from multiple env vars:

```ts
connection: {
  driver: "postgres",
  host: "localhost",
  port: 5432,
  database: "mydb",
  username: "app",
  password: process.env.DB_PASSWORD!,
  max: 20,
}
```

SQLite uses `filename` instead of `host`/`port`:

```ts
connection: { driver: "sqlite", filename: "./app.db" }
```

## `migrationsPath` vs `migrations`

There are two shapes for declaring where migration files live.

### Flat (single-tenant)

```ts
migrationsPath: "./database/migrations",
// or multiple roots merged in glob order
migrationsPath: ["./database/migrations", "./database/extra"],
```

### Grouped (multi-tenant)

```ts
migrations: {
  landlord: "./database/landlord-migrations",
  tenant:   "./database/tenant-migrations",
}
```

When `migrations.landlord` or `migrations.tenant` is set, the CLI's `bunny migrate landlord` and `bunny migrate tenant` commands target each group separately. The flat `migrationsPath` is still honored as a fallback when a scope is requested but its grouped path is missing.

### `createIfMissing`

Tell the migrator to provision the database or schema before running migrations:

```ts
migrations: {
  landlord: "./database/migrations",
  createIfMissing: true,                          // both database and schema
  // — or fine-grained —
  createIfMissing: { database: true, schema: false },
}
```

Driver behavior:

- **PostgreSQL** — connects to the `postgres` admin database, checks `pg_database`, and runs `CREATE DATABASE` if missing. Schemas use `CREATE SCHEMA IF NOT EXISTS`.
- **MySQL** — `CREATE DATABASE IF NOT EXISTS` via the `mysql` admin database. MySQL does not have schemas, so the `schema` option is a no-op.
- **SQLite** — the file is auto-created by Bun on connect. Both `database` and `schema` flags are no-ops.

See [Migrations](./migrations.md#auto-create-database-and-schema) for the full lifecycle.

## `seedersPath`

```ts
seedersPath: "./database/seeders",
// or
seedersPath: ["./database/seeders", "./database/test-fixtures"],
```

Used by `bunx bunny seed` and `bunny.seed()`. See [Seeders](./seeders.md).

## `tenancy`

Two callbacks turn an app into a multi-tenant system.

### `resolveTenant`

Maps a tenant identifier to a connection or schema. Three strategies are supported:

```ts
// Database-per-tenant — each tenant on its own database
tenancy: {
  resolveTenant: async (tenantId) => ({
    strategy: "database",
    name: `tenant:${tenantId}`,
    config: { url: await lookupDsn(tenantId) },
  }),
}

// Schema-per-tenant (Postgres only) — shared database, qualified table names
tenancy: {
  resolveTenant: async (tenantId) => ({
    strategy: "schema",
    name: `tenant:${tenantId}`,
    schema: `tenant_${tenantId}`,
    mode: "qualify", // or "search_path"
  }),
}

// Row-level security (Postgres) — same database, session var set per request
tenancy: {
  resolveTenant: async (tenantId) => ({
    strategy: "rls",
    name: `tenant:${tenantId}`,
    tenantId,
    setting: "app.current_tenant",
  }),
}
```

`name` is an internal cache key; pick something stable. The resolution is cached for the duration of the process.

### `listTenants`

Only used by the CLI when running grouped tenant migrations across every tenant (`bunx bunny migrate tenants`):

```ts
tenancy: {
  listTenants: async () => {
    const rows = await landlordDb.query("SELECT id FROM tenants");
    return rows.map((r) => r.id);
  },
}
```

Application code never calls this — it is purely for batch operations.

See [Library Usage](./library-usage.md) and the [Query Builder's `DB.tenant()`](./query-builder.md#multi-tenant-scope) section for runtime use.

## `modelsPath`

Tells the REPL and the type generator where to look for model classes:

```ts
modelsPath: "./src/models",
// or a list
modelsPath: ["./src/models", "./src/admin/models"],
// or partitioned for multi-tenant projects
modelsPath: {
  landlord: "./src/models/landlord",
  tenant:   "./src/models/tenant",
}
```

The grouped form lets `bunny migrate landlord` regenerate types only for landlord-scoped models.

## Type generation

```ts
typesOutDir: "./src/generated/model-types",       // optional legacy output dir
typeDeclarationImportPrefix: "$models",
typeDeclarationSingularModels: true,
typeDeclarations: {
  admin_users: { path: "$models/admin/AdminAccount", className: "AdminAccount" },
},
typeStubs: false,                                  // emit stubs instead of declarations
```

See [Type Generation](./type-generation.md) for the full feature reference.

## `logQueries`

```ts
logQueries: true,
```

Turns on SQL logging globally via `Connection.logQueries`. Useful in development; leave off in production unless you have query sampling in place.

## Wiring it up at runtime

The CLI loads `bunny.config.ts` automatically. Your application code activates the same config through `configureBunny()`:

```ts
// src/app.ts
import { configureBunny } from "@bunnykit/orm";
import config from "../bunny.config";

const bunny = configureBunny(config);

// bunny.connection — the live Connection
// bunny.migrate(), bunny.seed(), bunny.migrator(), bunny.seeder() — facade helpers
```

`configureBunny()` does four things on call:

1. Constructs a `Connection` from `config.connection` and registers it as the default.
2. Sets the connection on `Model` and `Schema` so static helpers work.
3. Wires up `tenancy.resolveTenant` if provided.
4. Toggles `Connection.logQueries` if `logQueries` is true.

It returns a [facade](./library-usage.md) you can use to run migrations and seeders programmatically.

## Environment variables (CLI only)

When no `bunny.config.ts` exists, the CLI falls back to env vars:

```bash
export DATABASE_URL="sqlite://app.db"
export MIGRATIONS_PATH="./database/migrations,./database/tenant-migrations"
export SEEDERS_PATH="./database/seeders"
export MODELS_PATH="./src/models"
export TYPES_OUT_DIR="./src/generated/model-types"
```

Comma-separated lists work where a config field accepts `string[]`. Prefer a real config file for anything beyond a quick experiment — the env-var path does not support `tenancy`, `createIfMissing`, or any of the type generation overrides.
