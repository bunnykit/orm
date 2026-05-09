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
- 🔷 **Fully Typed** — Written in TypeScript with generics everywhere
- 🏗️ **Schema Builder** — Programmatic table creation, indexes, foreign keys
- 🔍 **Query Builder** — Chainable `where`, `join`, `orderBy`, `groupBy`, date filters, conditional building, etc.
- 🧬 **Eloquent-style Models** — Property attributes, defaults, casts, dirty tracking, soft deletes, scopes, find-or-fail, first-or-create
- 🔗 **Relations** — Standard, many-to-many, polymorphic, through, one-of-many, and relation queries
- 👁️ **Observers** — Lifecycle hooks (`creating`, `created`, `updating`, `updated`, etc.)
- 🚀 **Migrations & CLI** — Create, run, and rollback migrations from the command line
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
  modelsPath: ["./src/models", "./src/admin/models"],
  // Optional legacy type output directory
  // typesOutDir: "./src/generated/model-types",
  // Optional typegen overrides
  // typeDeclarationImportPrefix: "../models",
  // typeDeclarations: {
  //   admin_users: { path: "../AdminAccount", className: "AdminAccount" },
  // },
};
```

Or use environment variables:

```bash
export DATABASE_URL="sqlite://app.db"
export MIGRATIONS_PATH="./database/migrations,./database/tenant-migrations"
export MODELS_PATH="./src/models,./src/admin/models"
export TYPES_OUT_DIR="./src/generated/model-types"
```

---

## Quick Start

### Define a Model

```ts
import { Model } from "@bunnykit/orm";

class User extends Model {
  // Optional — inferred as "users" if omitted
  static table = "users";

  posts() {
    return this.hasMany(Post);
  }
}

class Post extends Model {
  static table = "posts";

  author() {
    return this.belongsTo(User);
  }
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

```bash
bun run bunny migrate
bun run bunny migrate --landlord
bun run bunny migrate --tenants
bun run bunny migrate --tenant acme
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
const adults = await User.where("age", ">=", 18).orderBy("name").get();

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

The REPL exposes `Model`, `Schema`, `Connection`, `db`, and a `Models` map. Any model files under `modelsPath` are loaded automatically and also registered by class name on the global scope. If no project config is present, it starts against an in-memory SQLite database so you can still experiment immediately. This makes it useful for quick inspection, ad hoc queries, and schema experiments without adding any dependencies to your app.

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

The foreign key call adds the constraint only. Define the local column first, and make its type match the referenced column:

```ts
await Schema.create("users", (table) => {
  table.uuid("id").primary();
  table.string("email").unique();
  table.timestamps();
});

await Schema.create("posts", (table) => {
  table.increments("id");
  table.uuid("user_id");
  table.foreign("user_id").references("id").on("users").onDelete("cascade");
  table.string("title");
  table.text("content");
  table.timestamps();
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
| `get()`                                                    | Fetch all rows                      |
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
| `paginate(perPage?, page?)`                                | Paginated result set                |
| `chunk(n, fn)`                                             | Batch iterate                       |
| `each(n, fn)`                                              | Per-item iterate                    |
| `cursor()`                                                 | Lazy async generator                |
| `lazy(n?)`                                                 | Chunked lazy generator              |
| `insert(data)`                                             | Insert row(s)                       |
| `insertGetId(data, col?)`                                  | Insert and return ID                |
| `insertOrIgnore(data)`                                     | Insert, ignore conflicts            |
| `upsert(data, uniqueBy, updateCols?)`                      | Insert or update on conflict        |
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

```ts
class Product extends Model {
  static table = "products"; // override table name
  static primaryKey = "sku"; // override primary key
  static timestamps = false; // disable timestamps
  static softDeletes = true; // use deleted_at instead of hard deletes

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
const all = await User.all();
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
user.toJSON(); // plain object

// Increment / Decrement
await user.increment("login_count");
await user.increment("login_count", 5, { last_login_at: new Date() });
await user.decrement("stock", 10);

// First-or-Create / Update-or-Create
const user = await User.firstOrCreate(
  { email: "alice@example.com" },
  { name: "Alice" },
);
const user = await User.updateOrCreate(
  { email: "alice@example.com" },
  { name: "Alice Smith" },
);
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

# Show migration status
bun run bunny migrate:status
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

### Typing Model Attributes

```ts
interface UserAttributes {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

class User extends Model {
  static table = "users";
}

// Type inference works automatically on static methods
const user = await User.create({ name: "Alice", email: "a@example.com" });
// user is typed as User
```

### Query Builder Typing

```ts
// Builder<T> is inferred from the model class
const builder = User.where("name", "Alice"); // Builder<User>
const users: User[] = await builder.get();
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
```

Or configure in `bunny.config.ts`:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  migrationsPath: ["./database/migrations", "./database/tenant-migrations"],
  modelsPath: ["./src/models", "./src/admin/models"],
  // Optional legacy output directory, still supported when you do not want
  // the generated files beside each model root:
  typesOutDir: "./src/generated/model-types",
  // Optional override for custom module resolution when using typesOutDir:
  typeDeclarationImportPrefix: "../models",
  typeDeclarations: {
    admin_users: { path: "../AdminAccount", className: "AdminAccount" },
  },
};
```

With `modelsPath`, Bunny conventionally maps tables to singular PascalCase model modules and writes the generated declarations into `types/` beside each model root:

| Table        | Generated augmentation     |
| ------------ | -------------------------- |
| `users`      | `../User` / `User`         |
| `blog_posts` | `../BlogPost` / `BlogPost` |
| `categories` | `../Category` / `Category` |

Set `typeDeclarationSingularModels: false` if your model classes use plural names.

### Using Generated Declarations

For each table, Bunny generates an `Attributes` interface. If you configure `typeDeclarations`, it also augments your real model class:

```ts
// src/models/types/users.d.ts
export interface UsersAttributes {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
}

declare module "../User" {
  interface User {
    id: number;
    name: string;
    email: string | null;
    created_at: string;
  }
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

### Manual Typing (Without Codegen)

If you prefer not to use codegen, you can pass a type parameter directly:

```ts
interface UserAttributes {
  id: number;
  name: string;
  email: string;
}

class User extends Model<UserAttributes> {
  static table = "users";
}

// $attributes and getAttribute are now typed
const user = await User.first();
user.getAttribute("name"); // string
user.$attributes.email; // string
```

---

## Testing

Bunny includes a full test suite built with `bun:test`.

```bash
bun test
```

195 tests covering connection management, schema grammars, query builder, model CRUD, casts, scopes, soft deletes, relations, observers, migrations, type generation, lazy eager loading, find-or-fail, first-or-create, increment/decrement, touch, chunk/cursor/lazy streaming, date where clauses, conditional query building, whereNot, latest/oldest, or\* where variants, having/orHaving, orderByDesc/reorder, crossJoin, union, insertOrIgnore, upsert, delete with limit, skipLocked/noWait, JSON where clauses, like/regexp/fulltext, whereAll/whereAny, sole/value, selectRaw/fromSub, updateFrom, dump/dd, and explain.

---

## License

MIT
