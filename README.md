# Bunny

> **Bun-only package.** Install with:
>
> ```bash
> bun add @bunnykit/orm
> ```
>
> npm, yarn, pnpm, and Node.js runtime usage are not supported.

An **Eloquent-inspired ORM** built specifically for [Bun](https://bun.sh)'s native `bun:sql` client. It ships with **zero runtime dependencies** and supports **SQLite**, **MySQL**, and **PostgreSQL** with full TypeScript typing, a chainable query builder, schema migrations, model observers, polymorphic relations, and an interactive REPL.

---

## Features

- 🔥 **Bun-native** — Built on top of `bun:sql` for maximum performance
- 🪶 **Zero runtime dependencies** — No package lock-in beyond Bun itself
- 📦 **Multi-database** — SQLite, MySQL, and PostgreSQL support
- 🔷 **Fully Typed** — `Model.define<T>()` gives attribute access, typed `with()` autocomplete, and typed eager-load results with zero codegen
- 🏗️ **Schema Builder** — Programmatic table creation, indexes, foreign keys
- 🔍 **Query Builder** — Chainable `where`, `join`, `orderBy`, `groupBy`, date filters, conditional building, etc.
- 🧬 **Eloquent-style Models** — Property attributes, defaults, casts, dirty tracking, soft deletes, scopes, find-or-fail, first-or-create
- 🧺 **Collections** — Laravel-style helpers for multi-record query results
- 🔗 **Relations** — Standard, many-to-many, polymorphic, through, one-of-many, and relation queries
- 👁️ **Observers** — Lifecycle hooks (`creating`, `created`, `updating`, `updated`, etc.)
- 🚀 **Migrations & CLI** — Create, run, reset, refresh, and inspect migrations from the command line
- 🌱 **Seeders & Factories** — Run all seeders or target one seeder by name/file, plus lightweight model factories
- 💬 **REPL** — Inspect models and run queries interactively with `bunny repl`
- ⚡ **Streaming** — `chunk`, `cursor`, `each`, and `lazy` for memory-efficient large dataset processing

---

## Installation

```bash
bun add @bunnykit/orm
```

---

## Configuration

Create a `bunny.config.ts` (or `.js`) in your project root:

```ts
export default {
  connection: {
    // Option 1: connection string
    url: "sqlite://app.db",

    // Option 2: driver config (for MySQL / Postgres)
    // driver: "mysql",
    // host: "localhost",
    // port: 3306,
    // database: "mydb",
    // username: "root",
    // password: "secret",
  },
  migrationsPath: ["./database/migrations", "./database/tenant-migrations"],
  // Optional grouped migrations for multi-tenant apps
  // migrations: {
  //   landlord: "./database/landlord-migrations",
  //   tenant: "./database/tenant-migrations",
  //   createIfMissing: {
  //     database: true,
  //     schema: true,
  //   },
  // },
  // Optional tenant resolver for dynamic multi-tenant apps.
  // Apps call configureBunny(config) at startup to register this resolver.
  // tenancy: {
  //   resolveTenant: async (tenantId) => ({
  //     strategy: "database",
  //     name: `tenant:${tenantId}`,
  //     config: await getTenantConnectionConfig(tenantId),
  //   }),
  //   listTenants: async () => await getAllTenantIds(),
  // },
  seedersPath: "./database/seeders",
  // Unified path (string | string[]) — works for single-tenant apps
  modelsPath: ["./src/models", "./src/admin/models"],
  // Or partition by scope for multi-tenant apps:
  // modelsPath: {
  //   landlord: "./src/models/landlord",
  //   tenant: "./src/models/tenant",
  // },
  // Optional legacy type output directory
  // typesOutDir: "./src/generated/model-types",
  // Optional typegen overrides
  // typeDeclarationImportPrefix: "$models",
  // typeDeclarations: {
  //   admin_users: { path: "$models/admin/AdminAccount", className: "AdminAccount" },
  // },
};
```

Or use environment variables:

```bash
export DATABASE_URL="sqlite://app.db"
export MIGRATIONS_PATH="./database/migrations,./database/tenant-migrations"
export SEEDERS_PATH="./database/seeders"
export MODELS_PATH="./src/models,./src/admin/models"
export TYPES_OUT_DIR="./src/generated/model-types"
```

---

## Quick Start

### Define a Model

Use `Model.define<Attributes>(table)` to get full IntelliSense — attribute autocomplete, typed query builder columns, and typed eager-load results — with no code generation required:

```ts
import { Model } from "@bunnykit/orm";

interface UserAttributes {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

interface PostAttributes {
  id: number;
  user_id: number;
  title: string;
  body: string | null;
}

class User extends Model.define<UserAttributes>("users") {
  posts() {
    return this.hasMany(Post);
  }
}

class Post extends Model.define<PostAttributes>("posts") {
  author() {
    return this.belongsTo(User);
  }
}
```

All instance attribute access, `where()` column arguments, and `with()` relation names are fully typed from the interface.

Plain `extends Model` still works and is fine when types are provided by the code generator or are not needed:

```ts
class User extends Model {
  static table = "users";
}
```

### Set the Database Connection

```ts
import { Connection, Model, Schema } from "@bunnykit/orm";

const connection = new Connection({ url: "sqlite://app.db" });
Model.setConnection(connection);
Schema.setConnection(connection);
```

Or apply the same `bunny.config.ts` used by the CLI in your application bootstrap:

```ts
import config from "../bunny.config";
import { configureBunny } from "@bunnykit/orm";

const { connection } = configureBunny(config);
```

### Dynamic Tenant Connections

Use `ConnectionManager` and `TenantContext` when tenants are discovered at runtime instead of listed in config:

```ts
import { ConnectionManager, TenantContext } from "@bunnykit/orm";

ConnectionManager.setTenantResolver(async (tenantId) => {
  const tenant = await lookupTenant(tenantId); // your app owns this lookup

  return {
    strategy: "database",
    name: `tenant:${tenant.id}`,
    config: { url: tenant.databaseUrl },
  };
});

await TenantContext.run("acme", async () => {
  const users = await User.all();
  await Invoice.create({ total: 100 });
});
```

You can also define the resolver in `bunny.config.ts` and reuse the same config in your app and CLI:

```ts
// bunny.config.ts
export default {
  connection: { url: process.env.LANDLORD_DATABASE_URL! },
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

Then register it in app startup:

```ts
import config from "../bunny.config";
import { configureBunny } from "@bunnykit/orm";

configureBunny(config);
```

`configureBunny(config)` registers `tenancy.resolveTenant` for application code automatically. `listTenants()` is only used by the CLI when running grouped tenant migrations.

For PostgreSQL schema-per-tenant systems, return a shared database config plus a schema. PostgreSQL is the only supported driver for ORM-level schema switching; for MySQL and SQLite, use dynamic `strategy: "database"` instead.

```ts
ConnectionManager.setTenantResolver(async (tenantId) => ({
  strategy: "schema",
  name: `tenant:${tenantId}`,
  config: { url: process.env.DATABASE_URL!, schema: `tenant_${tenantId}` },
  schema: `tenant_${tenantId}`,
}));
```

For PostgreSQL systems that prefer `SET search_path` over table qualification, reuse the existing default connection and opt into transaction-scoped search path switching:

```ts
ConnectionManager.setTenantResolver(async (tenantId) => ({
  strategy: "schema",
  name: `tenant:${tenantId}`,
  schema: `tenant_${tenantId}`,
  mode: "search_path",
}));
```

`mode: "search_path"` runs the tenant callback inside a PostgreSQL transaction and applies `SET LOCAL search_path`, so the schema switch stays bound to the same database session and is reset when the transaction ends.

For PostgreSQL RLS, return `strategy: "rls"`. The ORM sets a transaction-local tenant variable before running the tenant callback. The setting defaults to `app.tenant_id`, but can be customized:

```ts
ConnectionManager.setTenantResolver(async (tenantId) => ({
  strategy: "rls",
  name: "main",
  tenantId,
  setting: "app.current_tenant_id",
}));
```

Your PostgreSQL policies should read the same setting, for example `current_setting('app.current_tenant_id')`.

Resolved tenants are cached. Use `await ConnectionManager.resolveTenant("acme")` to preload a tenant, `User.forTenant("acme")` for an already resolved tenant, and `ConnectionManager.purgeTenant("acme")` when tenant connection metadata changes.

### Landlord and Tenant Migrations

For multi-tenant apps, use grouped migrations so landlord tables and tenant tables can be migrated separately:

```ts
export default {
  connection: { url: process.env.LANDLORD_DATABASE_URL! },
  migrations: {
    landlord: ["./database/landlord-migrations", "./modules/billing/migrations"],
    tenant: ["./database/tenant-migrations", "./modules/tenant-features/migrations"],
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

With grouped migrations, `bun run bunny migrate` runs landlord migrations first, then tenant migrations for every tenant returned by `listTenants()`. Rollback runs in reverse order: tenants first, then landlord.

If you set `migrations.createIfMissing`, Bunny will create missing databases and/or schemas before running migration commands. This is disabled by default.

```bash
bun run bunny migrate
bun run bunny migrate --landlord
bun run bunny migrate --tenants
bun run bunny migrate --tenant acme
bun run bunny migrate:rollback --tenant acme
bun run bunny migrate:refresh --tenant acme
bun run bunny migrate:fresh --tenant acme
bun run bunny migrate:status --tenant acme
```

### Create Tables

```ts
import { Schema } from "@bunnykit/orm";

await Schema.create("users", (table) => {
  table.increments("id");
  table.string("name");
  table.string("email").unique();
  table.timestamps(); // created_at & updated_at
});

await Schema.create("posts", (table) => {
  table.increments("id");
  table.integer("user_id").unsigned();
  table.string("title");
  table.text("body").nullable();
  table.timestamps();
});
```

### CRUD Operations

```ts
// Create
const user = await User.create({ name: "Alice", email: "alice@example.com" });

// Find
const found = await User.find(1);

// Query
const adults = await User.where("age", ">=", 18).orderBy("name").get(); // Collection<User>

// Update
user.name = "Alice Smith";
await user.save();

// Delete
await user.delete();
```

### REPL

Start an interactive Bunny session with the ORM already loaded:

```bash
bunny repl
```

The REPL exposes `Model`, `Schema`, `Connection`, `Collection`, `collect`, `db`, and a `Models` map. Any model files under `modelsPath` are loaded automatically and also registered by class name on the global scope. If no project config is present, it starts against an in-memory SQLite database so you can still experiment immediately. This makes it useful for quick inspection, ad hoc queries, and schema experiments without adding any dependencies to your app.

---

## Schema Builder

### Creating Tables

```ts
await Schema.create("products", (table) => {
  table.increments("id");
  table.uuid("uuid").unique();
  table.string("name", 100);
  table.text("description").nullable();
  table.integer("stock").unsigned().default(0);
  table.decimal("price", 10, 2);
  table.boolean("active").default(true);
  table.json("metadata").nullable();
  table.timestamps();
  table.softDeletes(); // deleted_at
});
```

### Available Column Types

| Method                     | Description                           |
| -------------------------- | ------------------------------------- |
| `increments(name)`         | Auto-incrementing integer primary key |
| `bigIncrements(name)`      | Auto-incrementing big integer         |
| `string(name, length=255)` | VARCHAR                               |
| `text(name)`               | TEXT                                  |
| `integer(name)`            | INTEGER                               |
| `bigInteger(name)`         | BIGINT                                |
| `smallInteger(name)`       | SMALLINT                              |
| `tinyInteger(name)`        | TINYINT                               |
| `float(name, p=8, s=2)`    | FLOAT                                 |
| `double(name, p=8, s=2)`   | DOUBLE                                |
| `decimal(name, p=8, s=2)`  | DECIMAL                               |
| `boolean(name)`            | BOOLEAN                               |
| `date(name)`               | DATE                                  |
| `dateTime(name)`           | DATETIME                              |
| `time(name)`               | TIME                                  |
| `timestamp(name)`          | TIMESTAMP                             |
| `json(name)`               | JSON                                  |
| `jsonb(name)`              | JSONB (Postgres)                      |
| `binary(name)`             | BLOB / BYTEA                          |
| `uuid(name)`               | UUID                                  |
| `foreignId(name)`          | Unsigned big integer foreign key      |
| `foreignUuid(name)`        | UUID foreign key                      |
| `enum(name, values)`       | ENUM                                  |

### Column Modifiers

```ts
table.string("email").unique(); // UNIQUE index
table.string("slug").index(); // INDEX
table.string("name").nullable(); // NULLABLE
table.integer("role").default(1); // DEFAULT value
table.string("code").comment("SKU code");
table.integer("user_id").unsigned();
```

### Altering Tables

```ts
// Add columns
await Schema.table("users", (table) => {
  table.string("phone").nullable();
  table.timestamp("last_login").nullable();
});

// Change columns on MySQL/PostgreSQL
await Schema.table("users", (table) => {
  table.string("name", 150).nullable().change();
});

// Rename
await Schema.rename("users", "customers");

// Drop
await Schema.drop("old_table");
await Schema.dropIfExists("old_table");
```

### Foreign Keys

```ts
await Schema.create("posts", (table) => {
  table.increments("id");
  table.integer("user_id").unsigned();
table.foreign("user_id").references("id").on("users").onDelete("cascade");
});
```

### Indexes

```ts
await Schema.create("posts", (table) => {
  table.increments("id");
  table.string("title");
  table.string("slug").index(); // Index on single column
  table.index(["title", "slug"]); // Composite index with auto-generated name
  table.uniqueIndex(["slug"], "posts_slug_unique"); // Unique index with custom name
});
```

Available index methods:

| Method | Description |
|--------|-------------|
| `.index()` | Index the current column (auto-names the index) |
| `.index(columns)` | Multi-column index with auto-generated name |
| `.index(columns, name)` | Multi-column index with custom name |
| `.unique()` | UNIQUE constraint on current column |
| `.uniqueIndex(columns, name)` | Multi-column unique index |
| `.dropIndex(name)` | Remove an index |
| `.dropUnique(name)` | Remove a unique constraint |

Shortcut form:

```ts
await Schema.create("posts", (table) => {
  table.increments("id");
  table.foreignId("user_id").constrained().cascadeOnDelete();
  table.string("title");
  table.timestamps();
});
```

Polymorphic column shortcuts:

```ts
await Schema.create("comments", (table) => {
  table.increments("id");
  table.uuidMorphs("commentable"); // commentable_type + UUID commentable_id + index
  table.text("body");
});

await Schema.create("activity", (table) => {
  table.increments("id");
  table.nullableMorphs("subject"); // nullable subject_type + subject_id + index
});
```

---

## Query Builder

Every model exposes a query builder via static methods:

```ts
// Static entry points
User.where("active", true);
User.where({ role: "admin", active: true });
User.whereIn("id", [1, 2, 3]);
User.whereNull("deleted_at");
User.whereNotNull("email");
User.whereNot("status", "banned");

// Date filtering (cross-database)
Event.whereDate("happened_at", "2024-01-01");
Event.whereYear("created_at", ">=", 2023);
Event.whereMonth("birthday", 12);
Event.whereDay("anniversary", 14);
Event.whereTime("opened_at", "09:00:00");

// or* variants
User.where("role", "admin").orWhereNull("email");
User.where("status", "active").orWhereIn("role", ["admin", "mod"]);
User.where("price", ">=", 100).orWhereBetween("price", [10, 50]);
User.where("name", "Alice").orWhereExists("SELECT 1 FROM orders WHERE orders.user_id = users.id");
User.where("a", 1).orWhereColumn("updated_at", ">", "created_at");
User.where("active", true).orWhereRaw("score > 100");

// Chaining
const results = await User
  .where("age", ">=", 18)
  .whereIn("role", ["admin", "moderator"])
  .orderBy("created_at", "desc")
  .limit(10)
  .offset(0)
  .get();

// Conditional building
User.when(filters.name, (q) => q.where("name", filters.name))
    .when(filters.age,  (q) => q.where("age", ">=", filters.age))
    .unless(showAll,    (q) => q.where("active", true))
    .tap((q) => console.log(q.toSql()));

// Ordering convenience
Post.latest().first();        // orderBy created_at desc
Post.oldest("published_at");  // orderBy published_at asc
Post.orderByDesc("score");    // shorthand
Post.orderBy("name").reorder();        // clear orders
Post.orderBy("name").reorder("id");    // replace with new order

// Aggregates
const count = await User.where("active", true).count();
const exists = await User.where("email", "test@example.com").exists();
const doesntExist = await User.where("email", "missing@example.com").doesntExist();

// Joins
const posts = await Post
  .query()
  .select("posts.*", "users.name as author_name")
  .join("users", "posts.user_id", "=", "users.id")
  .leftJoin("comments", "comments.post_id", "=", "posts.id")
  .crossJoin("tags")
  .get();

// Group by / Having
User.select("role").groupBy("role").having("count", ">", 1);
User.groupBy("role").havingRaw("COUNT(*) > 1").orHavingRaw("SUM(score) > 100");

// Union
const q1 = User.where("active", true);
const q2 = User.where("role", "admin");
const results = await q1.union(q2).get();
const allResults = await q1.unionAll(q2).get();

// Pluck
const emails = await User.pluck("email");

// First / Find / Sole
const user = await User.where("email", "alice@example.com").first();
const byId = await User.find(1);
const name = await User.where("id", 1).value("name"); // single scalar
const sole = await User.where("email", "alice@example.com").sole(); // exactly one or throw

// Find-or-Fail (throws if not found)
const user = await User.findOrFail(1);
const first = await User.firstOrFail();

// Streaming large datasets
await User.chunk(100, (users) => { ... });
await User.each(100, (user) => { ... });
for await (const user of User.cursor()) { ... }
for await (const user of User.lazy(500)) { ... }

// Raw / Subquery helpers
User.select("name").selectRaw("price * 2 as doubled");
User.fromSub(User.where("price", ">", 100), "expensive");

// Debug
User.where("name", "Alice").dump();   // logs SQL, returns builder
User.where("name", "Alice").dd();     // logs SQL and throws
```

### Collections

Queries that return multiple records use `Collection<T>`:

```ts
import { collect, Collection } from "@bunnykit/orm";

const users = await User.where("active", true).orderBy("name").get();

users instanceof Collection; // true
users.length;                // array-compatible length
users[0];                    // array-compatible index access
users.all();                 // plain User[]
users.toArray();             // plain User[]
```

Collections are iterable and JSON-serialize as arrays, so existing loops and API responses keep the expected shape:

```ts
for (const user of users) {
  console.log(user.email);
}

JSON.stringify(users); // [{"id":1,...}]
```

Use collection helpers for in-memory transformations:

```ts
const emails = users.pluck("email");
const admins = users.where("role", "admin");
const activeIds = users.where("active", true).pluck("id");
const byEmail = users.keyBy("email");
const byRole = users.groupBy("role");
const topUsers = users.sortByDesc("score").take(10);

users.isEmpty();
users.isNotEmpty();
users.first();
users.last();
users.firstWhere("email", "alice@example.com");
users.contains("role", "admin");
users.sum("score");
users.avg("score");
users.min("score");
users.max("score");
```

`chunk()` callbacks and paginator `data` also receive collections:

```ts
await User.chunk(100, (users) => {
  users.pluck("email");
});

const page = await User.paginate(15, 1);
page.data instanceof Collection; // true
```

If you need a plain array directly from a query, use `getArray()`:

```ts
const usersArray = await User.where("active", true).getArray(); // User[]
```

You can also wrap any iterable manually:

```ts
const numbers = collect([1, 2, 3]);
numbers.sum(); // 6
```

### Query Builder Reference

| Method                                                     | Description                         |
| ---------------------------------------------------------- | ----------------------------------- |
| `where(col, op, val)`                                      | Basic equality or operator filter   |
| `where(obj)`                                               | Object of column → value pairs      |
| `where(fn)`                                                | Nested where group via closure      |
| `orWhere(...)`                                             | OR variant of `where`               |
| `whereNot(col, val)`                                       | `!=` filter                         |
| `orWhereNot(...)`                                          | OR `!=`                             |
| `whereIn(col, vals)`                                       | `IN` set                            |
| `orWhereIn(...)`                                           | OR `IN`                             |
| `whereNotIn(col, vals)`                                    | `NOT IN`                            |
| `orWhereNotIn(...)`                                        | OR `NOT IN`                         |
| `whereNull(col)`                                           | `IS NULL`                           |
| `orWhereNull(...)`                                         | OR `IS NULL`                        |
| `whereNotNull(col)`                                        | `IS NOT NULL`                       |
| `orWhereNotNull(...)`                                      | OR `IS NOT NULL`                    |
| `whereBetween(col, [a, b])`                                | `BETWEEN`                           |
| `orWhereBetween(...)`                                      | OR `BETWEEN`                        |
| `whereNotBetween(col, [a, b])`                             | `NOT BETWEEN`                       |
| `orWhereNotBetween(...)`                                   | OR `NOT BETWEEN`                    |
| `whereExists(sql)`                                         | `EXISTS (subquery)`                 |
| `orWhereExists(...)`                                       | OR `EXISTS`                         |
| `whereNotExists(sql)`                                      | `NOT EXISTS`                        |
| `orWhereNotExists(...)`                                    | OR `NOT EXISTS`                     |
| `whereColumn(a, op, b)`                                    | Compare two columns                 |
| `orWhereColumn(...)`                                       | OR column compare                   |
| `whereRaw(sql)`                                            | Raw SQL where clause                |
| `orWhereRaw(...)`                                          | OR raw SQL                          |
| `whereDate(col, op, val)`                                  | Cross-database date filter          |
| `whereDay / whereMonth / whereYear / whereTime`            | Date part filters                   |
| `whereJsonContains(col, val)`                              | JSON membership (cross-db)          |
| `whereJsonLength(col, op, val)`                            | JSON array length                   |
| `whereLike(col, pattern)`                                  | `LIKE` pattern                      |
| `whereNotLike(...)`                                        | `NOT LIKE`                          |
| `whereRegexp(col, pattern)`                                | Regular expression match            |
| `whereFullText(cols, query)`                               | Full-text search (cross-db)         |
| `whereAll(cols, op, val)`                                  | Multi-column `AND`                  |
| `whereAny(cols, op, val)`                                  | Multi-column `OR`                   |
| `orderBy(col, dir)`                                        | Sort ascending or descending        |
| `orderByDesc(col)`                                         | Sort descending shorthand           |
| `latest(col?)`                                             | `orderBy(created_at, desc)`         |
| `oldest(col?)`                                             | `orderBy(created_at, asc)`          |
| `inRandomOrder()`                                          | `ORDER BY RANDOM()` / `RAND()`      |
| `reorder(col?, dir?)`                                      | Clear and optionally replace orders |
| `groupBy(...cols)`                                         | `GROUP BY`                          |
| `having(col, op, val)`                                     | `HAVING` filter                     |
| `orHaving(...)`                                            | OR `HAVING`                         |
| `havingRaw(sql)`                                           | Raw `HAVING`                        |
| `orHavingRaw(...)`                                         | OR raw `HAVING`                     |
| `join(tbl, a, op, b)`                                      | `INNER JOIN`                        |
| `leftJoin(...)`                                            | `LEFT JOIN`                         |
| `rightJoin(...)`                                           | `RIGHT JOIN`                        |
| `crossJoin(tbl)`                                           | `CROSS JOIN`                        |
| `union(query, all?)`                                       | `UNION` another query               |
| `unionAll(query)`                                          | `UNION ALL`                         |
| `select(...cols)`                                          | Choose columns                      |
| `addSelect(...cols)`                                       | Append columns                      |
| `selectRaw(sql)`                                           | Raw SELECT expression               |
| `fromSub(query, alias)`                                    | Derived table from subquery         |
| `distinct()`                                               | `SELECT DISTINCT`                   |
| `limit(n)`                                                 | Row limit                           |
| `offset(n)`                                                | Row offset                          |
| `take(n)`                                                  | Alias for `limit`                   |
| `skip(n)`                                                  | Alias for `offset`                  |
| `forPage(page, perPage)`                                   | Pagination offset/limit             |
| `lockForUpdate()`                                          | `FOR UPDATE` (MySQL/Postgres)       |
| `sharedLock()`                                             | `LOCK IN SHARE MODE` / `FOR SHARE`  |
| `skipLocked()`                                             | Append `SKIP LOCKED`                |
| `noWait()`                                                 | Append `NOWAIT`                     |
| `get()`                                                    | Fetch all rows as `Collection<T>`   |
| `getArray()`                                               | Fetch all rows as a plain array     |
| `first()`                                                  | Fetch first row                     |
| `find(id, col?)`                                           | Find by ID                          |
| `findOrFail(id, col?)`                                     | Find or throw                       |
| `firstOrFail()`                                            | First or throw                      |
| `sole()`                                                   | Exactly one row or throw            |
| `value(col)`                                               | Single scalar from first row        |
| `pluck(col)`                                               | Array of column values              |
| `count(col?)`                                              | `COUNT` aggregate                   |
| `sum(col)`                                                 | `SUM`                               |
| `avg(col)`                                                 | `AVG`                               |
| `min(col)`                                                 | `MIN`                               |
| `max(col)`                                                 | `MAX`                               |
| `exists()`                                                 | Check any rows exist                |
| `doesntExist()`                                            | Check no rows exist                 |
| `paginate(perPage?, page?)`                                | Paginated result set with collection `data` |
| `chunk(n, fn)`                                             | Batch iterate with collection chunks |
| `each(n, fn)`                                              | Per-item iterate                    |
| `cursor()`                                                 | Lazy async generator                |
| `lazy(n?)`                                                 | Chunked lazy generator              |
| `insert(data, options?)`                                        | Insert row(s) with optional chunking     |
| `insertGetId(data, col?)`                                       | Insert and return ID                    |
| `insertOrIgnore(data)`                                          | Insert, ignore conflicts                |
| `upsert(data, uniqueBy, updateCols?, options?)`                 | Insert or update on conflict, optional chunking |
| `update(data)`                                             | Update matched rows                 |
| `updateFrom(tbl, a, op, b)`                                | Update with JOIN                    |
| `delete()`                                                 | Delete matched rows                 |
| `increment(col, amt?, extra?)`                             | Add to column                       |
| `decrement(col, amt?, extra?)`                             | Subtract from column                |
| `restore()`                                                | Restore soft-deleted rows           |
| `with(...rels)`                                            | Eager load relations                |
| `has(rel)` / `orHas(rel)`                                  | Relation existence                  |
| `whereHas(rel, fn?)` / `orWhereHas(...)`                   | Filtered relation existence         |
| `doesntHave(rel)` / `whereDoesntHave(...)`                 | Relation absence                    |
| `withCount(rel)` / `withSum / withAvg / withMin / withMax` | Relation aggregates                 |
| `scope(name, ...args)`                                     | Apply local scope                   |
| `withoutGlobalScope(name)` / `withoutGlobalScopes()`       | Remove scopes                       |
| `withTrashed()` / `onlyTrashed()`                          | Soft delete visibility              |
| `when(cond, fn, elseFn?)` / `unless(...)`                  | Conditional building                |
| `tap(fn)`                                                  | Mutate and return                   |
| `clone()`                                                  | Copy builder state                  |
| `toSql()`                                                  | Compile to SQL string               |
| `dump()`                                                   | Log SQL, return builder             |
| `dd()`                                                     | Log SQL and halt                    |
| `explain()`                                                | Return query plan                   |

---

## Models

### Conventions

- **Table name**: inferred from the class name in `snake_case` + plural `s`.
  - `class User` → table `users`
  - `class BlogPost` → table `blog_posts`
- **Primary key**: defaults to `id`
- **Timestamps**: `created_at` and `updated_at` are managed automatically (disable with `static timestamps = false`)

### Defining Models

#### With `Model.define<T>()` (recommended for typed models)

Pass the attribute interface and table name to `Model.define<T>()` to get a typed base class. The returned class has all static query methods (`query()`, `find()`, `create()`, etc.) and instance attributes fully typed:

```ts
interface ProductAttributes {
  id: number;
  sku: string;
  name: string;
  price: string;
  active: boolean;
  metadata: Record<string, any> | null;
}

class Product extends Model.define<ProductAttributes>("products") {
  static primaryKey = "sku";
  static timestamps = false;
  static softDeletes = true;

  static attributes = {
    active: true,
    status: "draft",
  };

  static casts = {
    active: "boolean",
    price: "decimal:2",
    metadata: "json",
  };
}
```

For tables with irregular plural names (e.g. `curricula`), pass the class name as the second argument so foreign key inference works correctly when the class is assigned to a variable instead of subclassed:

```ts
// Subclassed — class name is always correct:
class Curriculum extends Model.define<CurriculumAttributes>("curricula") {}

// Direct assignment — provide name explicitly:
const Curriculum = Model.define<CurriculumAttributes>("curricula", "Curriculum");
```

#### Without `Model.define<T>()` (plain class)

```ts
class Product extends Model {
  static table = "products";
  static primaryKey = "sku";
  static timestamps = false;
  static softDeletes = true;

  static attributes = {
    active: true,
    status: "draft",
  };

  static casts = {
    active: "boolean",
    price: "decimal:2",
    metadata: "json",
  };
}
```

### Model Methods

```ts
// Static
const all = await User.all(); // Collection<User>
const user = await User.create({ name: "Alice" });
const found = await User.find(1);
const first = await User.first();
const builder = User.where("active", true);

// Instance
user.fill({ name: "Bob", email: "bob@example.com" });
user.name; // property access
user.name = "Charlie"; // property assignment
user.getAttribute("name"); // explicit access still works
user.setAttribute("name", "Dana");
user.isDirty(); // true if attributes changed
user.getDirty(); // { name: "Charlie" }
await user.save();
await user.delete();
await user.refresh();
await user.touch(); // update only timestamps
await user.load("posts"); // lazy eager loading
user.toJSON(); // plain object with attributes and relations
user.json({ relations: false }); // attributes only

// Increment / Decrement
await user.increment("login_count");
await user.increment("login_count", 5, { last_login_at: new Date() });
await user.decrement("stock", 10);

// First-or-Create / Update-or-Create
const user = await User.firstOrCreate(
  { email: "alice@example.com" },
  { name: "Alice" },
);
const user = await User.updateOrInsert(
  { email: "alice@example.com" },
  { name: "Alice Smith" },
);

// Bulk insert / upsert (apply fillable, casts, timestamps, UUID keys)
await User.insert([
  { name: "Alice", email: "alice1@example.com" },
  { name: "Bob", email: "alice2@example.com" },
], { chunkSize: 100 });

await User.upsert(
  [{ email: "alice@example.com", name: "Alice Updated" }],
  "email",
  ["name"],
  { chunkSize: 100 },
);

// Bulk create / save (fire model events by default)
const users = await User.createMany([
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
]);

await User.saveMany(users);

// Bypass observers with { events: false }
await User.createMany(records, { events: false });
await User.saveMany(models, { events: false });
model.save({ events: false });
```

### Serialization

Models can be serialized to plain objects with `toJSON()` and `json()`. Both methods include a model's attributes and any eagerly loaded relations by default.

```ts
const user = await User.with("posts").first();

user.toJSON();
// { id: 1, name: "Alice", posts: [{ id: 1, title: "Hello" }, ...] }

user.json();
// Same as toJSON()

user.json({ relations: false });
// { id: 1, name: "Alice" } — attributes only, no relations
```

`toJSON()` is the standard JavaScript serialization hook, so `JSON.stringify(user)` will also include loaded relations. Use `json({ relations: false })` when you need only the model's attributes.

### Bulk Operations

Bunny provides bulk methods for inserting, upserting, and creating multiple records efficiently. All bulk insert and upsert operations apply fillable rules, attribute casts, timestamps, and UUID key generation automatically.

#### Model.insert(records, options?)

Insert raw records with automatic processing. Respects `fillable` guard, applies casts and timestamps, and generates UUID keys for `primaryKey = "uuid"` models.

```ts
await User.insert([
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
], { chunkSize: 500 });
```

`chunkSize` batches large inserts to avoid exceeding query size limits.

#### Model.upsert(records, uniqueBy, updateColumns?, options?)

Insert or update records based on a unique key. On insert: applies fillable, casts, timestamps, and UUID generation. On update: only the specified `updateColumns` are modified.

```ts
// Insert or update by email, updating only the name
await User.upsert(
  [{ email: "alice@example.com", name: "Alice Updated" }],
  "email",
  ["name"],
  { chunkSize: 500 },
);

// Insert or update by email, updating all columns except the unique key
await User.upsert(
  [{ email: "alice@example.com", name: "Alice", active: true }],
  "email",
);
```

#### Model.updateOrInsert(attributes, values)

Find a record by `attributes` and update with `values`, or create a new record if not found. Combines `firstOrCreate` logic with the ability to pass explicit create values.

```ts
const user = await User.updateOrInsert(
  { email: "alice@example.com" },
  { name: "Alice Smith", active: true },
);
```

#### Model.create(attributes, options?)

Create and persist a single model instance. Pass `{ events: false }` to bypass observers for that insert.

```ts
const user = await User.create({ name: "Ada Lovelace", email: "ada@example.test" });
await User.create({ name: "Silent", email: "silent@example.test" }, { events: false });
```

#### Model.createMany(records, options?)

Create multiple model instances with full ORM support. Fires `creating` / `created` observers by default. Pass `{ events: false }` to bypass observers for better performance.

```ts
const users = await User.createMany([
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
]);

// Bypass observers for bulk create
await User.createMany(records, { events: false });
```

#### Model.saveMany(models, options?)

Persist an array of new or existing model instances. Existing models trigger update observers and update `updated_at`. New models trigger create observers. Auto-increment IDs are preserved when saving new models silently one-by-one where needed. Pass `{ events: false }` to bypass all observers.

```ts
const users = [
  new User({ name: "Alice" }),
  new User({ id: 5, name: "Bob" }), // existing record
];

await User.saveMany(users);

// Bypass observers for bulk save
await User.saveMany(models, { events: false });
```

#### model.save(options?)

Save an existing model instance. Pass `{ events: false }` to bypass `updating` / `updated` observers.

```ts
user.name = "Charlie";
await user.save({ events: false });
```

### Default Attributes

Use `static attributes` to give new model instances in-memory defaults before saving:

```ts
class User extends Model {
  static attributes = {
    active: true,
    role: "member",
  };
}

const user = new User({ name: "Ada" });
user.active; // true
user.role; // "member"
```

These are model defaults, not database defaults. Values provided by the caller override them.

### Attribute Casting

`static casts` transforms values on read and serializes them on write:

```ts
class User extends Model {
  static casts = {
    active: "boolean",
    login_count: "integer",
    price: "decimal:2",
    settings: "json",
    secret: "encrypted",
  };
}

const user = new User({
  active: true,
  settings: { theme: "dark" },
});

user.$attributes.active; // 1
user.active; // true
user.settings.theme; // "dark"
```

Supported built-in casts:

| Cast                                          | Behavior                                            |
| --------------------------------------------- | --------------------------------------------------- |
| `boolean`, `bool`                             | Stores `1` / `0`, reads boolean                     |
| `number`, `integer`, `int`, `float`, `double` | Reads/writes numbers                                |
| `decimal:2`                                   | Stores fixed precision string                       |
| `string`                                      | Reads/writes string                                 |
| `date`, `datetime`                            | Reads as `Date`, stores ISO string for `Date` input |
| `json`, `array`, `object`                     | Stores JSON string, reads parsed value              |
| `enum`                                        | Stores enum `.value` when present                   |
| `encrypted`                                   | Base64 encodes on write and decodes on read         |

Custom casts can implement `CastsAttributes`:

```ts
import type { CastsAttributes, Model } from "@bunnykit/orm";

class UppercaseCast implements CastsAttributes {
  get(_model: Model, _key: string, value: unknown) {
    return String(value).toLowerCase();
  }

  set(_model: Model, _key: string, value: unknown) {
    return String(value).toUpperCase();
  }
}

class User extends Model {
  static casts = {
    code: UppercaseCast,
  };
}
```

You can also add instance-only casts at runtime:

```ts
user.mergeCasts({ count: "string" });
```

### Soft Deletes

Enable soft deletes with `static softDeletes = true` and a `deleted_at` column:

```ts
class User extends Model {
  static softDeletes = true;
}

await user.delete(); // sets deleted_at
await user.restore(); // clears deleted_at
await user.forceDelete(); // permanently deletes

await User.all(); // excludes trashed rows
await User.withTrashed().get(); // includes trashed rows
await User.onlyTrashed().get(); // only trashed rows
await User.onlyTrashed().restore();
```

### Scopes

Local scopes are static methods named `scopeName`:

```ts
class User extends Model {
  static scopeActive(query) {
    return query.where("active", true);
  }
}

const users = await User.scope("active").get();
```

Global scopes apply automatically to all queries:

```ts
User.addGlobalScope("tenant", (query) => {
  query.where("tenant_id", 1);
});

await User.withoutGlobalScope("tenant").get();
await User.withoutGlobalScopes().get();
```

---

## Relationships

### Standard Relations

```ts
class User extends Model {
  posts() {
    return this.hasMany(Post); // foreignKey: user_id, localKey: id
  }

  profile() {
    return this.hasOne(Profile); // foreignKey: user_id, localKey: id
  }
}

class Post extends Model {
  author() {
    return this.belongsTo(User); // foreignKey: user_id, ownerKey: id
  }
}
```

Keys are **automatically inferred** from the model names. You can override them:

```ts
this.hasMany(Post, "author_id", "uuid");
this.belongsTo(User, "author_id", "uuid");
```

### Belongs To Helpers

Use `associate` and `dissociate` to update the foreign key for a `belongsTo` relation:

```ts
const post = new Post({ title: "Draft" });
post.author().associate(user);
post.user_id; // user's id

post.author().dissociate();
post.user_id; // null
```

### Through Relations

Use `hasManyThrough` and `hasOneThrough` for distant relations through an intermediate model:

```ts
class Country extends Model {
  posts() {
    return this.hasManyThrough(Post, User);
  }

  profile() {
    return this.hasOneThrough(Profile, User);
  }
}
```

By convention, Bunny expects:

- intermediate table foreign key to parent: `country_id`
- final table foreign key to intermediate: `user_id`

You can override keys:

```ts
this.hasManyThrough(Post, User, "country_uuid", "author_id", "uuid", "id");
this.hasOneThrough(Profile, User, "country_id", "user_id");
```

### Many-to-Many Relations

Use `belongsToMany` for many-to-many relationships via an intermediate pivot table:

```ts
class User extends Model {
  roles() {
    return this.belongsToMany(Role);
  }
}

class Role extends Model {
  users() {
    return this.belongsToMany(User);
  }
}
```

By default, Bunny infers the pivot table name from the two model names sorted alphabetically: `role_user` for `Role` and `User`.

#### Pivot Columns

Use `.withPivot()` to select specific columns from the pivot table:

```ts
this.belongsToMany(Role).withPivot("created_at", "is_active");
```

#### Pivot Timestamps

Use `.withTimestamps()` to auto-select `created_at` and `updated_at` from the pivot table:

```ts
this.belongsToMany(Role).withTimestamps();
```

Combine them:

```ts
this.belongsToMany(Subject, "curriculum_subjects")
  .withPivot(["id", "year_level", "term"])
  .withTimestamps();
```

Each related model in the result includes a `.pivot` property with the pivot data:

```ts
const subjects = await curriculum.subjects().withPivot(["year_level", "term"]).withTimestamps().get();

for (const subject of subjects) {
  console.log(subject.name, subject.pivot.year_level, subject.pivot.term);
}
```

#### Attaching and Detaching

Attach related records to the pivot table:

```ts
await user.roles().attach([1, 2, 3]);
await user.roles().attach(1, { is_active: true }); // with pivot attributes
```

Detach related records:

```ts
await user.roles().detach([2, 3]);
await user.roles().detach(); // detach all
```

Sync the pivot table to match a given list:

```ts
await user.roles().sync([1, 2]);        // keep only 1 and 2
await user.roles().sync([1, 2], false); // don't detach missing records
```

### One-of-Many Relations

Convert a `hasMany` relation into a single latest, oldest, or aggregate-selected relation:

```ts
class User extends Model {
  posts() {
    return this.hasMany(Post);
  }

  latestPost() {
    return this.posts().latestOfMany("id");
  }

  oldestPost() {
    return this.posts().oldestOfMany("id");
  }

  highestScoringPost() {
    return this.posts().ofMany("score", "max");
  }
}

const post = await user.latestPost().getResults();
```

### Eager Loading

Use `with()` to eager load relations for query results:

```ts
const users = await User.with("posts", "profile").get();
const posts = await Post.with("author").get();
```

Nested relations use dot notation:

```ts
const users = await User.with("posts.comments").get();
```

#### IntelliSense for `with()`

When models use `Model.define<T>()`, relation names autocomplete in `with()` — including dot-notation nested paths up to three levels deep:

```ts
// All of these autocomplete:
Semester.with("sections");
Semester.with("sections.offerings");
Semester.with("sections.offerings.subjects");
```

Invalid relation names are a TypeScript error. Raw strings are still accepted as an escape hatch.

#### Typed Eager Load Results

Results from `get()`, `first()`, `find()`, etc. reflect what was loaded. The relation key on each model switches from the method signature to its loaded value type:

```ts
const years = await AcademicCalendar
  .with("semesters", "semesters.gradingPeriods")
  .orderBy("created_at", "desc")
  .get();

years.map((y) => {
  y.semesters;                     // Collection<Semester>  ✓
  y.semesters[0].gradingPeriods;   // Collection<GradingPeriod>  ✓
});
```

Without `with()`, `y.semesters` remains `() => HasMany<Semester>` (the relation method).

| Relation type      | Loaded type            |
|--------------------|------------------------|
| `hasMany`          | `Collection<R>`        |
| `belongsToMany`    | `Collection<R>`        |
| `morphMany`        | `Collection<R>`        |
| `morphToMany`      | `Collection<R>`        |
| `hasOne`           | `R \| null`            |
| `belongsTo`        | `R \| null`            |
| `morphOne`         | `R \| null`            |

#### Constrained Eager Loading

Pass an object to constrain an eager-loaded relation. The callback `q` is typed to the related model, so its `where()` columns and `with()` relation names also autocomplete:

```ts
const users = await User.with({
  posts: (q) => q.where("status", "published").orderBy("created_at", "desc"),
}).get();
```

Dot-notation keys in the constraint object work too, and the callback is typed to the model at the end of the path:

```ts
const semesters = await Semester.with({
  "sections.offerings.registrationSubjects": (q) =>
    q.where("enrolled", true).with("subject"),
  //                                         ^ autocompletes RegistrationSubject's relations
}).get();
```

Multiple constraints can be combined:

```ts
const users = await User.with(
  { posts: (q) => q.where("status", "published") },
  { "posts.comments": (q) => q.where("approved", true) },
).get();
```

Constrained eager loading is also available when loading relations onto an existing model:

```ts
await user.load({
  posts: (query) => query.where("status", "published"),
});
```

### Relation Queries and Aggregates

Filter models by related records:

```ts
const usersWithPosts = await User.has("posts").get();

const usersWithPublishedPosts = await User.whereHas("posts", (query) => {
  query.where("status", "published");
}).get();

const usersWithoutPosts = await User.doesntHave("posts").get();
```

Add relation aggregate columns:

```ts
const users = await User.withCount("posts")
  .withSum("posts", "views")
  .withAvg("posts", "score")
  .withMin("posts", "created_at")
  .withMax("posts", "created_at")
  .get();

users[0].posts_count;
users[0].posts_sum_views;
```

### Polymorphic Relations

```ts
import { Model, MorphMap } from "@bunnykit/orm";

// Register morph types so morphTo knows which model to instantiate
MorphMap.register("Post", Post);
MorphMap.register("Video", Video);

class Comment extends Model {
  commentable() {
    return this.morphTo("commentable"); // reads commentable_type / commentable_id
  }
}

class Post extends Model {
  comments() {
    return this.morphMany(Comment, "commentable");
  }
}

class Video extends Model {
  comments() {
    return this.morphMany(Comment, "commentable");
  }

  thumbnail() {
    return this.morphOne(Image, "imageable");
  }
}
```

`morphTo` relations can be eager loaded:

```ts
const comments = await Comment.with("commentable").get();

comments[0].getRelation("commentable"); // Post | Video | null
```

Relation names are inferred for `with(...)` when your model methods return relation objects, while raw strings still work for dynamic relation names:

```ts
await Post.with("comments").get();
```

### Many-to-Many Polymorphic

```ts
class Post extends Model {
  tags() {
    return this.morphToMany(Tag, "taggable");
  }
}

class Tag extends Model {
  posts() {
    return this.morphedByMany(Post, "taggable");
  }
}
```

Pivot table: `taggables(tag_id, taggable_id, taggable_type)`.

### Customizing Morph Type

```ts
class Post extends Model {
  static morphName = "post"; // stored in {name}_type column
}
```

---

## Observers

Register observers to hook into model lifecycle events:

```ts
import { ObserverRegistry } from "@bunnykit/orm";

ObserverRegistry.register(User, {
  async creating(model) {
    console.log("About to create:", model.getAttribute("email"));
  },
  async created(model) {
    console.log("Created user id:", model.getAttribute("id"));
  },
  async updating(model) {
    console.log("User is changing:", model.getDirty());
  },
  async updated(model) {
    // ...
  },
  async saving(model) {
    // Runs before both create and update
  },
  async saved(model) {
    // Runs after both create and update
  },
  async deleting(model) {
    // ...
  },
  async deleted(model) {
    // ...
  },
});
```

---

## Seeders and Factories

Set `seedersPath` in `bunny.config.ts` to define the default directory used by `db:seed`:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  seedersPath: "./database/seeders",
};
```

`seedersPath` can also be an array:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  seedersPath: ["./database/seeders", "./modules/demo/seeders"],
};
```

Create a seeder by extending `Seeder`:

```ts
import { Seeder } from "@bunnykit/orm";
import { User } from "../models/User";

export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await User.create({ name: "Ada Lovelace", email: "ada@example.test" });
  }
}
```

Run every seeder in `seedersPath`:

```bash
bun run bunny db:seed
```

Run one seeder by class/file name from `seedersPath`:

```bash
bun run bunny db:seed UserSeeder
```

Run one seeder by direct file path:

```bash
bun run bunny db:seed ./database/seeders/UserSeeder.ts
```

For multi-tenant apps, `db:seed` can run in tenant context too:

```bash
bun run bunny db:seed --tenant acme
bun run bunny db:seed --tenant acme UserSeeder
bun run bunny db:seed --tenants
```

When the command runs inside `TenantContext`, `SeederRunner` uses that active tenant connection automatically.
Seeder runs are atomic: if any seeder throws, the whole run is rolled back.

Programmatic seeding is available through `SeederRunner`:

```ts
import { SeederRunner } from "@bunnykit/orm";

await new SeederRunner(connection).runTarget("UserSeeder", "./database/seeders");
await new SeederRunner(connection).runFile("./database/seeders/UserSeeder.ts");
```

Factories can create raw attributes, unsaved models, or persisted records:

```ts
import { factory } from "@bunnykit/orm";
import { User } from "../models/User";

const users = factory(User, (sequence) => ({
  name: `User ${sequence}`,
  email: `user${sequence}@example.test`,
}));

const attributes = users.raw();
const model = users.make();
const created = await users.count(3).state({ role: "admin" }).create();
```

---

## Migrations

### CLI Commands

```bash
# Create a new migration file
bun run bunny migrate:make CreateUsersTable

# Create in a specific folder
bun run bunny migrate:make CreateUsersTable ./database/tenant-migrations

# Run all pending migrations
bun run bunny migrate

# Rollback the last batch
bun run bunny migrate:rollback

# Rollback all migrations
bun run bunny migrate:reset

# Reset and rerun migrations
bun run bunny migrate:refresh

# Drop all tables and rerun migrations
bun run bunny migrate:fresh

# Show migration status
bun run bunny migrate:status

# Run all seeders in seedersPath
bun run bunny db:seed

# Run one seeder by name from seedersPath
bun run bunny db:seed UserSeeder

# Run one seeder by direct file path
bun run bunny db:seed ./database/seeders/UserSeeder.ts

# Dump the current database schema
bun run bunny schema:dump ./database/schema.sql

# Dump schema and mark configured migrations as ran
bun run bunny schema:squash ./database/schema.sql
```

### Migration File Structure

```ts
import { Migration, Schema } from "@bunnykit/orm";

export default class CreateUsersTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").unique();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.dropIfExists("users");
  }
}
```

Migrations are tracked in a `migrations` table (auto-created on first run).
If `migrations.createIfMissing` is enabled, Bunny will also create the target database and/or schema before the migration run starts when they do not exist yet.

### Migration Events

Listen to migration lifecycle events when running migrations programmatically:

```ts
import { Migrator } from "@bunnykit/orm";

Migrator.on("migrating", ({ migration }) => {
  console.log(`Starting ${migration}`);
});

Migrator.on("migrated", ({ migration }) => {
  console.log(`Finished ${migration}`);
});
```

Available events: `migrating`, `migrated`, `rollingBack`, `rolledBack`, `schemaDumped`, and `schemaSquashed`.

### Schema Dumps

Programmatic schema dumps are available through the migrator:

```ts
const migrator = new Migrator(connection, "./database/migrations");

await migrator.dumpSchema("./database/schema.sql");
await migrator.squash("./database/schema.sql");
```

`squash()` writes the schema dump and marks the configured migration files as already ran in the migrations table.

### Auto Type Generation

If you set `typesOutDir` in your config, types are **automatically regenerated** after every `migrate` and `migrate:rollback`.

If you set `modelsPath`, Bunny writes declaration files into a `types/` folder next to each model root and regenerates those files after migrations too:

```bash
bun run bunny migrate
# → Migrated: 2026xxxx_create_users_table.ts
# → Regenerated types in ./src/models/types, ./src/admin/models/types
```

No extra step needed — your models stay in sync with the schema automatically.

---

## Using as a Library (Programmatic Migrations)

```ts
import { Connection, Migrator, MigrationCreator } from "@bunnykit/orm";

const connection = new Connection({ url: "sqlite://app.db" });

// Create a migration file
const creator = new MigrationCreator();
const path = await creator.create("CreateOrdersTable", "./database/migrations");

// Run migrations
const migrator = new Migrator(connection, "./database/migrations");
await migrator.run();

// Rollback
await migrator.rollback();
```

---

## TypeScript Tips

### Model.define\<T\>() — Full IntelliSense Without Codegen

The recommended way to type a model is to extend `Model.define<T>(table)`. This unlocks:

- **Attribute access** — `user.name` instead of `user.getAttribute("name")`
- **Column autocomplete** — `User.where("email", ...)`, `User.orderBy("created_at")`
- **`with()` relation autocomplete** — string names and dot-notation paths
- **Typed eager load results** — `y.posts` is `Collection<Post>` after `.with("posts")`

```ts
interface UserAttributes {
  id: number;
  name: string;
  email: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

class User extends Model.define<UserAttributes>("users") {
  posts() { return this.hasMany(Post); }
  profile() { return this.hasOne(Profile); }
}

// Attribute access
const user = await User.find(1);
user.name;         // string
user.email;        // string | null
user.active;       // boolean

// Column autocomplete in query builder
User.where("email", "alice@example.com");   // ✓
User.orderBy("created_at", "desc");          // ✓
User.where("nonexistent", "x");              // ✗ TS error

// with() autocomplete
User.with("posts");                          // ✓
User.with("posts.comments");                 // ✓ nested
User.with("nonexistent");                    // ✗ TS error

// Typed eager-load results
const users = await User.with("posts").get();
users[0].posts;    // Collection<Post>
```

### Model\<T\> Generic — Alternative

Pass the type directly to `Model<T>` without using `define()`. This types `$attributes` and `getAttribute()` but does not add transparent property access or typed `with()` results:

```ts
class User extends Model<UserAttributes> {
  static table = "users";
}

const user = await User.first();
user.getAttribute("name"); // string
user.$attributes.email;    // string | null
user.name;                 // ✗ not typed — use getAttribute()
```

### Query Builder Typing

```ts
import type { Collection } from "@bunnykit/orm";

// Builder<T> is inferred from the model class
const builder = User.where("name", "Alice"); // Builder<User>
const users: Collection<User> = await builder.get();
const usersArray: User[] = await builder.getArray();
```

---

## Type Generation (IntelliSense)

Bunny can introspect your database schema and generate TypeScript declaration files for your existing models. This gives you **full IntelliSense** for model properties without changing your model source files:

```ts
const user = await User.first();
user.name; // ✅ autocomplete + type-checking
user.email = "a@example.com"; // ✅ typed setter
```

### Generate Types

```bash
# Generate into default directory (./generated/models)
bun run bunny types:generate

# Generate into model-local ./types folders when modelsPath is configured
bun run bunny types:generate

# Generate into a custom directory
bun run bunny types:generate ./src/generated

# Multi-tenant: landlord only
bun run bunny types:generate --landlord

# Multi-tenant: one specific tenant only
bun run bunny types:generate --tenant acme
```

Or configure in `bunny.config.ts`:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  migrationsPath: ["./database/migrations", "./database/tenant-migrations"],
  // Unified path for single-tenant apps
  modelsPath: ["./src/models", "./src/admin/models"],
  // Optional legacy output directory, still supported when you do not want
  // the generated files beside each model root:
  typesOutDir: "./src/generated/model-types",
  // Optional override for custom module resolution when using typesOutDir:
  // When models are discovered, subdirectories are preserved automatically.
  typeDeclarationImportPrefix: "$models",
  // Explicit per-table overrides (takes precedence over convention):
  typeDeclarations: {
    admin_users: { path: "$models/admin/AdminAccount", className: "AdminAccount" },
  },
};
```

#### Multi-Tenancy

For multi-tenant apps, partition `modelsPath` into `landlord` and `tenant` scopes. Bunny will use the correct connection for each:

```ts
export default {
  connection: { url: "postgres://localhost/landlord" },
  modelsPath: {
    landlord: "./src/models/landlord",
    tenant: "./src/models/tenant",
  },
  typesOutDir: "./src/generated/types",
  typeDeclarationImportPrefix: "$models",
  tenancy: {
    resolveTenant: (tenantId) => ({ strategy: "schema", name: "tenant_db", schema: `tenant_${tenantId}` }),
    listTenants: () => ["acme", "globex"],
  },
};
```

```bash
# Generate both landlord and tenant types (uses first tenant for schema introspection)
bun run bunny types:generate

# Landlord only
bun run bunny types:generate --landlord

# One specific tenant only
bun run bunny types:generate --tenant acme
```

Landlord types are introspected via the default connection. Tenant types are introspected via a resolved tenant connection (`TenantContext.run`). Because all tenants share an identical schema, only one representative tenant is needed.

> **Note:** Keep landlord and tenant model directories non-overlapping. If one scope's path is a subdirectory of another (e.g., `tenant: "./src/models"` containing `landlord/` inside it), Bunny automatically excludes the nested scope during discovery so types don't leak across scopes.

With `modelsPath`, Bunny discovers your actual model files and writes the generated declarations into `types/` beside each model root. Discovered models use their real file path, so subfolders are preserved automatically. The generator also reads `tsconfig.json` `compilerOptions.paths` and emits an additional `declare module` block for every alias that resolves to the model file — so intellisense works regardless of how you import the model (`../User`, `$models/User`, `@app/models/User`, etc.):

| Table        | Model file                     | No prefix (relative)    | With `typeDeclarationImportPrefix: "$models"` |
| ------------ | ------------------------------ | ----------------------- | --------------------------------------------- |
| `users`      | `src/models/User.ts`           | `../User` / `User`      | `$models/User` / `User`                       |
| `blog_posts` | `src/models/BlogPost.ts`       | `../BlogPost` / `BlogPost` | `$models/BlogPost` / `BlogPost`            |
| `tenants`    | `src/models/landlord/tenant.ts`| `../landlord/tenant` / `Tenant` | `$models/landlord/tenant` / `Tenant`    |

Set `typeDeclarationSingularModels: false` if your model classes use plural names.

### Using Generated Declarations

For each table, Bunny generates an `Attributes` interface. If you configure `typeDeclarations`, it also augments your real model class:

```ts
// src/models/types/users.d.ts
import { User } from "../User";

export interface UsersAttributes {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
}

declare module "../User" {
  interface User extends UsersAttributes {}
}
```

Your actual model stays hand-written:

```ts
// models/User.ts
import { Model } from "@bunnykit/orm";

export class User extends Model {
  static table = "users";

  posts() {
    return this.hasMany(Post);
  }
}
```

Editors that include the generated `.d.ts` files in `tsconfig.json` will understand `user.name`, `user.email`, etc. The same generated attributes are also used for column-name autocomplete in model and builder APIs:

```ts
await User.where("email", "alice@example.com").first();
await User.where({ email: "alice@example.com" }).first();
await User.orderBy("created_at").get();
await User.create({ id: 1, name: "Alice", email: "alice@example.com" });
```

Column arguments still accept raw strings for joins, aliases, expressions, and advanced SQL, so autocomplete is helpful without blocking escape hatches. The generated files can be safely **gitignored** and regenerated whenever your schema changes.

If you still want generated base classes, use the programmatic generator with `{ stubs: true }`.

### Typing Without Codegen

If you prefer not to use the code generator, use `Model.define<T>()` for the best experience:

```ts
interface UserAttributes {
  id: number;
  name: string;
  email: string | null;
}

class User extends Model.define<UserAttributes>("users") {
  posts() { return this.hasMany(Post); }
}

const user = await User.first();
user.name;  // string — direct property access, no getAttribute() needed
```

Or use `Model<T>` to type `$attributes` and `getAttribute()` without property proxying:

```ts
class User extends Model<UserAttributes> {
  static table = "users";
}

const user = await User.first();
user.getAttribute("name"); // string
user.$attributes.email;    // string | null
```

---

## Testing

Bunny includes a full test suite built with `bun:test`.

```bash
bun test
```

309 tests covering connection management, schema grammars, query builder, collections, model CRUD, casts, scopes, soft deletes, relations, observers, migrations, type generation, lazy eager loading, find-or-fail, first-or-create, increment/decrement, touch, chunk/cursor/lazy streaming, date where clauses, conditional query building, whereNot, latest/oldest, or\* where variants, having/orHaving, orderByDesc/reorder, crossJoin, union, insertOrIgnore, upsert, delete with limit, skipLocked/noWait, JSON where clauses, like/regexp/fulltext, whereAll/whereAny, sole/value, selectRaw/fromSub, updateFrom, dump/dd, and explain.

---

## License

MIT
