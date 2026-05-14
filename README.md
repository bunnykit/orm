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
- ⚡ **Streaming** — `chunk`, `chunkById`, `cursor`, `each`, `eachById`, and `lazy` for memory-efficient large dataset processing

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
table.string("email").unique();    // UNIQUE index
table.string("slug").index();      // INDEX
table.string("name").nullable();   // NULLABLE
table.integer("role").default(1);  // DEFAULT value
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

// Shortcut form
await Schema.create("posts", (table) => {
  table.increments("id");
  table.foreignId("user_id").constrained().cascadeOnDelete();
  table.string("title");
  table.timestamps();
});
```

### Indexes

```ts
await Schema.create("posts", (table) => {
  table.increments("id");
  table.string("title");
  table.string("slug").index();                        // single-column index
  table.index(["title", "slug"]);                      // composite index, auto-name
  table.uniqueIndex(["slug"], "posts_slug_unique");    // unique index, custom name
});
```

| Method | Description |
|--------|-------------|
| `.index()` | Index the current column (auto-names the index) |
| `.index(columns)` | Multi-column index with auto-generated name |
| `.index(columns, name)` | Multi-column index with custom name |
| `.unique()` | UNIQUE constraint on current column |
| `.uniqueIndex(columns, name)` | Multi-column unique index |
| `.dropIndex(name)` | Remove an index |
| `.dropUnique(name)` | Remove a unique constraint |

### Polymorphic Column Shortcuts

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

Every model exposes a chainable query builder via static methods.

### Basic Queries

```ts
const all   = await User.all();                           // all rows
const found = await User.find(1);                         // by primary key
const first = await User.first();                         // first row
const user  = await User.where("email", "a@b.com").first();
const users = await User.where("active", true).orderBy("name").get(); // Collection<User>
const arr   = await User.where("active", true).getArray(); // plain User[]

// Find-or-fail (throws ModelNotFoundException if not found)
const user  = await User.findOrFail(1);
const first = await User.firstOrFail();

// Exactly one row or throw (throws if zero or more than one)
const sole  = await User.where("email", "alice@example.com").sole();

// Single scalar value from the first row
const name  = await User.where("id", 1).value("name");

// Array of a single column's values
const emails = await User.pluck("email");
```

### Where Clauses

```ts
// Equality
User.where("active", true)
User.where({ role: "admin", active: true })   // object shorthand
User.where((q) => q.where("a", 1).orWhere("b", 2)) // nested group

// Operators
User.where("age", ">=", 18)
User.whereNot("status", "banned")             // !=
User.whereIn("role", ["admin", "mod"])
User.whereNotIn("status", ["banned", "spam"])
User.whereNull("deleted_at")
User.whereNotNull("email")
User.whereBetween("age", [18, 65])
User.whereNotBetween("score", [0, 10])

// OR variants
User.where("role", "admin").orWhere("role", "mod")
User.where("a", 1).orWhereNot("b", 2)
User.where("a", 1).orWhereIn("role", ["x", "y"])
User.where("a", 1).orWhereNull("email")
User.where("a", 1).orWhereBetween("score", [5, 10])

// Column comparison
User.whereColumn("updated_at", ">", "created_at")
User.where("a", 1).orWhereColumn("updated_at", ">", "created_at")

// EXISTS subquery
User.whereExists("SELECT 1 FROM orders WHERE orders.user_id = users.id")
User.where("a", 1).orWhereExists("SELECT 1 FROM posts WHERE posts.user_id = users.id")
User.whereNotExists("SELECT 1 FROM orders WHERE orders.user_id = users.id")

// Raw SQL
User.whereRaw("score > 100")
User.where("active", true).orWhereRaw("score > 100")

// Date parts (cross-database)
Event.whereDate("happened_at", "2024-01-01")
Event.whereYear("created_at", ">=", 2023)
Event.whereMonth("birthday", 12)
Event.whereDay("anniversary", 14)
Event.whereTime("opened_at", "09:00:00")

// JSON (cross-database)
User.whereJsonContains("settings", { theme: "dark" })
User.whereJsonLength("tags", ">", 2)

// LIKE / Regexp / Full-text
User.whereLike("name", "Ali%")
User.whereNotLike("name", "Bot%")
User.whereRegexp("email", "^alice")
User.whereFullText(["bio", "summary"], "laravel orm")

// Multi-column AND / OR
User.whereAll(["first_name", "last_name"], "like", "%smith%")
User.whereAny(["email", "phone"], "like", "%example%")
```

### Ordering, Grouping & Limiting

```ts
User.orderBy("name", "asc")
User.orderByDesc("created_at")          // shorthand
User.latest()                           // orderBy created_at desc
User.latest("published_at")
User.oldest()                           // orderBy created_at asc
User.inRandomOrder()                    // ORDER BY RANDOM() / RAND()
User.orderBy("name").reorder()          // clear all orders
User.orderBy("name").reorder("id")      // replace with new order

User.limit(10).offset(20)
User.take(10).skip(20)                  // aliases for limit/offset
User.forPage(3, 15)                     // page 3, 15 per page

User.groupBy("role")
User.groupBy("role").having("count", ">", 1)
User.groupBy("role").havingRaw("COUNT(*) > 1").orHavingRaw("SUM(score) > 100")
```

### Joins

```ts
const posts = await Post
  .query()
  .select("posts.*", "users.name as author_name")
  .join("users", "posts.user_id", "=", "users.id")
  .leftJoin("comments", "comments.post_id", "=", "posts.id")
  .crossJoin("tags")
  .get();
```

### Unions

```ts
const q1 = User.where("active", true);
const q2 = User.where("role", "admin");

const results    = await q1.union(q2).get();    // UNION (deduplicates)
const allResults = await q1.unionAll(q2).get(); // UNION ALL (keeps duplicates)
```

### Aggregates

```ts
const count  = await User.where("active", true).count();
const exists = await User.where("email", "test@example.com").exists();
const none   = await User.where("email", "missing@example.com").doesntExist();
const total  = await Order.sum("amount");
const avg    = await Order.avg("amount");
const min    = await Product.min("price");
const max    = await Product.max("price");
```

### Streaming Large Datasets

Use streaming to process large tables without loading everything into memory at once.

```ts
// chunk — process records in batches of N
await User.chunk(100, (users) => {
  // users is a Collection<User> with up to 100 items
});

// each — one record at a time (same as chunk but callback receives single item)
await User.each(100, (user) => {
  console.log(user.getAttribute("name"));
});

// chunkById / eachById — keyset pagination, no offset drift on large tables
// Safe even if rows are inserted or deleted during iteration
await User.chunkById(100, (users) => {
  users.pluck("email");
});

await User.eachById(100, (user) => {
  console.log(user.getAttribute("email"));
});

// Custom ID column for chunkById / eachById
await User.chunkById(100, (users) => { ... }, "uuid");

// Descending keyset chunks
await User.chunkByIdDesc(100, (users) => {
  users.pluck("id"); // newest IDs first
});

// cursor — async generator, yields one row at a time
for await (const user of User.cursor()) {
  console.log(user.getAttribute("name"));
}

// lazy — chunked async generator (better than cursor for very large tables)
for await (const user of User.lazy(500)) {
  console.log(user.getAttribute("name"));
}

// lazyById — keyset chunked async generator
for await (const user of User.lazyById(500)) {
  console.log(user.getAttribute("email"));
}
```

### Pagination

```ts
const page = await User.orderBy("name").paginate(15, 1);
// { data: Collection<User>, total: number, perPage: 15, currentPage: 1, lastPage: number }

page.data;        // Collection<User>
page.total;       // total row count
page.lastPage;    // last page number
page.json();      // plain object for API responses

const simple = await User.orderBy("name").simplePaginate(15, 1);
simple.data;             // Collection<User>
simple.has_more_pages;   // boolean
simple.next_page;        // number | null
simple.prev_page;        // number | null
// No total/last_page query is run.

const first = await User.orderBy("id").cursorPaginate(15);
first.data;        // Collection<User>
first.next_cursor; // opaque string | null

if (first.next_cursor) {
  const next = await User.orderBy("id").cursorPaginate(15, first.next_cursor);
  next.prev_cursor; // cursor used to fetch this page
}
```

### Conditional Building

```ts
const filters = { name: "Alice", age: 25 };
const showAll  = false;

const users = await User
  .when(filters.name, (q) => q.where("name", filters.name))
  .when(filters.age,  (q) => q.where("age", ">=", filters.age))
  .unless(showAll,    (q) => q.where("active", true))
  .tap((q) => console.log(q.toSql()))
  .get();
```

### Select, Raw & Subquery

```ts
User.select("name", "email")
User.addSelect("role")                                // append without replacing
User.select("name").selectRaw("price * 2 as doubled")
User.fromSub(User.where("price", ">", 100), "expensive")
User.select("*").distinct()
User.orderByRaw("LOWER(name) ASC")
User.selectRaw("DATE(created_at) as day, COUNT(*) as total").groupByRaw("DATE(created_at)")
```

### Locking (MySQL / PostgreSQL)

```ts
await User.where("id", 1).lockForUpdate().first()   // FOR UPDATE
await User.where("id", 1).sharedLock().first()      // LOCK IN SHARE MODE / FOR SHARE
await Job.where("status", "pending").skipLocked().limit(10).get()  // SKIP LOCKED
await Job.where("status", "pending").noWait().first()              // NOWAIT
```

### Bulk Write Operations

```ts
// Raw insert (no model events)
await User.query().insert({ name: "Alice", email: "alice@example.com" });
await User.query().insertOrIgnore([{ email: "a@b.com" }, { email: "c@d.com" }]);
const id = await User.query().insertGetId({ name: "Bob" });

// Upsert — insert or update on conflict
await User.query().upsert(
  [{ email: "alice@example.com", name: "Alice" }],
  ["email"],       // unique key columns
  ["name"],        // columns to update on conflict
);

// Update matched rows
await User.where("active", false).update({ deleted: true });

// Update with JOIN (SQL Server / PostgreSQL)
await Post.query().updateFrom("users", "users.id", "=", "posts.user_id");

// Delete
await User.where("active", false).delete();

// Increment / Decrement
await user.increment("login_count");
await user.increment("login_count", 5, { last_login_at: new Date() });
await user.decrement("stock", 10);
await User.where("active", false).decrement("score", 2);
```

### Debugging

```ts
User.where("name", "Alice").toSql()  // compile to SQL string without running
User.where("name", "Alice").dump()   // log SQL to console, return builder (chainable)
User.where("name", "Alice").dd()     // log SQL and throw (halt execution)
await User.where("name", "Alice").explain() // return query plan
```

### Query Builder Reference

Most query builder helpers can be called either from `Model.query()` or directly on the model class:

```ts
await Room.whereExists("SELECT 1 FROM bookings WHERE bookings.room_id = rooms.id").get();
await Room.whereBetween("capacity", [2, 8]).orderByDesc("capacity").get();
```

| Method | Description |
| ---------------------------------------------------------- | ----------------------------------- |
| `where(col, op, val)` | Basic equality or operator filter |
| `where(obj)` | Object of column → value pairs |
| `where(fn)` | Nested where group via closure |
| `orWhere(...)` | OR variant of `where` |
| `whereNot(col, val)` | `!=` filter |
| `orWhereNot(...)` | OR `!=` |
| `whereIn(col, vals)` | `IN` set |
| `orWhereIn(...)` | OR `IN` |
| `whereNotIn(col, vals)` | `NOT IN` |
| `orWhereNotIn(...)` | OR `NOT IN` |
| `whereNull(col)` | `IS NULL` |
| `orWhereNull(...)` | OR `IS NULL` |
| `whereNotNull(col)` | `IS NOT NULL` |
| `orWhereNotNull(...)` | OR `IS NOT NULL` |
| `whereBetween(col, [a, b])` | `BETWEEN` |
| `orWhereBetween(...)` | OR `BETWEEN` |
| `whereNotBetween(col, [a, b])` | `NOT BETWEEN` |
| `orWhereNotBetween(...)` | OR `NOT BETWEEN` |
| `whereExists(sql)` | `EXISTS (subquery)` |
| `orWhereExists(...)` | OR `EXISTS` |
| `whereNotExists(sql)` | `NOT EXISTS` |
| `orWhereNotExists(...)` | OR `NOT EXISTS` |
| `whereColumn(a, op, b)` | Compare two columns |
| `orWhereColumn(...)` | OR column compare |
| `whereRaw(sql)` | Raw SQL where clause |
| `orWhereRaw(...)` | OR raw SQL |
| `whereDate(col, op, val)` | Cross-database date filter |
| `whereDay / whereMonth / whereYear / whereTime` | Date part filters |
| `whereJsonContains(col, val)` | JSON membership (cross-db) |
| `whereJsonLength(col, op, val)` | JSON array length |
| `whereLike(col, pattern)` | `LIKE` pattern |
| `whereNotLike(...)` | `NOT LIKE` |
| `whereRegexp(col, pattern)` | Regular expression match |
| `whereFullText(cols, query)` | Full-text search (cross-db) |
| `whereAll(cols, op, val)` | Multi-column `AND` |
| `whereAny(cols, op, val)` | Multi-column `OR` |
| `whereKey(id \| ids)` | Filter by the model primary key |
| `whereKeyNot(id \| ids)` | Exclude by the model primary key |
| `orderBy(col, dir)` | Sort ascending or descending |
| `orderByDesc(col)` | Sort descending shorthand |
| `orderByRaw(sql)` | Raw `ORDER BY` expression |
| `latest(col?)` | `orderBy(created_at, desc)` |
| `oldest(col?)` | `orderBy(created_at, asc)` |
| `inRandomOrder()` | `ORDER BY RANDOM()` / `RAND()` |
| `reorder(col?, dir?)` | Clear and optionally replace orders |
| `groupBy(...cols)` | `GROUP BY` |
| `groupByRaw(sql)` | Raw `GROUP BY` expression |
| `having(col, op, val)` | `HAVING` filter |
| `orHaving(...)` | OR `HAVING` |
| `havingRaw(sql)` | Raw `HAVING` |
| `orHavingRaw(...)` | OR raw `HAVING` |
| `join(tbl, a, op, b)` | `INNER JOIN` |
| `leftJoin(...)` | `LEFT JOIN` |
| `rightJoin(...)` | `RIGHT JOIN` |
| `crossJoin(tbl)` | `CROSS JOIN` |
| `union(query, all?)` | `UNION` another query |
| `unionAll(query)` | `UNION ALL` |
| `select(...cols)` | Choose columns |
| `addSelect(...cols)` | Append columns |
| `selectRaw(sql)` | Raw SELECT expression |
| `fromSub(query, alias)` | Derived table from subquery |
| `distinct()` | `SELECT DISTINCT` |
| `limit(n)` / `take(n)` | Row limit |
| `offset(n)` / `skip(n)` | Row offset |
| `forPage(page, perPage)` | Pagination offset/limit |
| `lockForUpdate()` | `FOR UPDATE` (MySQL/Postgres) |
| `sharedLock()` | `LOCK IN SHARE MODE` / `FOR SHARE` |
| `skipLocked()` | Append `SKIP LOCKED` |
| `noWait()` | Append `NOWAIT` |
| `get()` | Fetch all rows as `Collection<T>` |
| `getArray()` | Fetch all rows as a plain array |
| `first()` | Fetch first row |
| `find(id, col?)` | Find by ID |
| `findMany(ids)` | Fetch many rows by primary key |
| `findOrFail(id, col?)` | Find or throw |
| `firstWhere(col, op?, val)` | Apply one where clause and fetch first |
| `firstOrFail()` | First or throw |
| `sole()` | Exactly one row or throw |
| `value(col)` | Single scalar from first row |
| `pluck(col)` | Array of column values |
| `count(col?)` | `COUNT` aggregate |
| `sum(col)` | `SUM` |
| `avg(col)` | `AVG` |
| `min(col)` | `MIN` |
| `max(col)` | `MAX` |
| `exists()` | Check any rows exist |
| `doesntExist()` | Check no rows exist |
| `paginate(perPage?, page?)` | Paginated result set with total/last-page metadata |
| `simplePaginate(perPage?, page?)` | Offset pagination without a total count query |
| `cursorPaginate(perPage?, cursor?)` | Keyset pagination with opaque next cursor |
| `chunk(n, fn)` | Batch iterate with collection chunks |
| `each(n, fn)` | Per-item iterate |
| `chunkById(n, fn, col?)` | Keyset-paginated chunk (no offset drift) |
| `chunkByIdDesc(n, fn, col?)` | Descending keyset-paginated chunk |
| `eachById(n, fn, col?)` | Keyset-paginated per-item iterate |
| `cursor()` | Lazy async generator |
| `lazy(n?)` | Chunked lazy generator |
| `lazyById(n?, col?)` | Keyset chunked lazy generator |
| `insert(data, options?)` | Insert row(s) with optional chunking |
| `insertGetId(data, col?)` | Insert and return ID |
| `insertOrIgnore(data)` | Insert, ignore conflicts |
| `upsert(data, uniqueBy, updateCols?, options?)` | Insert or update on conflict |
| `update(data)` | Update matched rows |
| `updateFrom(tbl, a, op, b)` | Update with JOIN |
| `delete()` | Delete matched rows |
| `increment(col, amt?, extra?)` | Add to column |
| `decrement(col, amt?, extra?)` | Subtract from column |
| `restore()` | Restore soft-deleted rows |
| `with(...rels)` | Eager load relations |
| `has(rel)` / `orHas(rel)` | Relation existence |
| `whereHas(rel, fn?)` / `orWhereHas(...)` | Filtered relation existence |
| `doesntHave(rel)` / `whereDoesntHave(...)` | Relation absence |
| `whereRelation(rel, col, op?, val)` | Filter by related column (shorthand) |
| `orWhereRelation(...)` | OR variant of `whereRelation` |
| `whereMorphedTo(rel, model)` | Filter a `morphTo` relation by type/id |
| `orWhereMorphedTo(rel, model)` | OR variant of `whereMorphedTo` |
| `whereNotMorphedTo(rel, model)` | Exclude a `morphTo` target |
| `withWhereHas(rel, fn?)` | Filter + eager load in one call |
| `withCount(rel)` / `withSum(rel, col, alias?, fn?)` / `withAvg / withMin / withMax` | Relation aggregates |
| `withExists(rel, alias?, fn?)` | Add a typed boolean relation-exists field |
| `scope(name, ...args)` | Apply local scope |
| `withoutGlobalScope(name)` / `withoutGlobalScopes()` | Remove scopes |
| `withTrashed()` / `onlyTrashed()` | Soft delete visibility |
| `when(cond, fn, elseFn?)` / `unless(...)` | Conditional building |
| `tap(fn)` | Mutate and return |
| `clone()` | Copy builder state |
| `toSql()` | Compile to SQL string |
| `dump()` | Log SQL, return builder |
| `dd()` | Log SQL and halt |
| `explain()` | Return query plan |

---

## Collections

Queries that return multiple records use `Collection<T>`, which extends `Array` and adds Laravel-style helpers.

### Basic Usage

```ts
import { collect, Collection } from "@bunnykit/orm";

const users = await User.where("active", true).orderBy("name").get();

users instanceof Collection; // true
users.length;                // standard array length
users[0];                    // index access
users.all();                 // plain User[]
users.toArray();             // alias for all()
JSON.stringify(users);       // [{"id":1,...}] — serializes as array

for (const user of users) {
  console.log(user.getAttribute("name"));
}
```

If you need a plain array directly from a query, use `getArray()`:

```ts
const usersArray = await User.where("active", true).getArray(); // User[]
```

Wrap any iterable manually with `collect()`:

```ts
const numbers = collect([1, 2, 3]);
numbers.sum(); // 6
```

### Helpers

```ts
// Transforming
users.pluck("email")                          // Collection of email values
users.pluck("address.city")                   // dot-notation path
users.keyBy("email")                          // Record<string, User> keyed by email
users.keyBy((u) => u.getAttribute("role"))    // key by callback
users.groupBy("role")                         // Record<string, Collection<User>>

// Filtering
users.where("role", "admin")                  // equality filter
users.whereIn("role", ["admin", "mod"])        // IN filter
users.reject((u) => u.getAttribute("active") === false) // inverse of filter

// Sorting
users.sortBy("name")                          // ascending
users.sortByDesc("created_at")                // descending
users.sortBy((u) => u.getAttribute("score"))  // by callback

// Slicing
users.take(10)                                // first N
users.skip(5)                                 // drop first N
users.take(-3)                                // last 3

// Finding
users.first()                                 // first item or null
users.first((u) => u.getAttribute("active"))  // first matching predicate
users.last()                                  // last item or null
users.firstWhere("email", "alice@example.com")
users.get(0)                                  // by index, null if missing
users.contains("role", "admin")               // key/value check
users.contains((u) => u.getAttribute("active")) // predicate check

// Aggregates
users.count()
users.sum("score")
users.avg("score")
users.min("score")
users.max("score")

// Iteration
users.each((user, index) => console.log(index, user.getAttribute("name")))

// State
users.isEmpty()
users.isNotEmpty()

// Serialization
users.toJSON()  // array of plain objects (calls toJSON() on each item)
users.json()    // alias for toJSON()
```

---

## Models

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

### Conventions

- **Table name**: inferred from the class name in `snake_case` + plural `s`.
  - `class User` → table `users`
  - `class BlogPost` → table `blog_posts`
- **Primary key**: defaults to `id`
- **Timestamps**: `created_at` and `updated_at` are managed automatically (disable with `static timestamps = false`)

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
user.role;   // "member"
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

const user = new User({ active: true, settings: { theme: "dark" } });

user.$attributes.active; // 1      (stored)
user.active;             // true   (cast on read)
user.settings.theme;     // "dark" (parsed from JSON)
```

Supported built-in casts:

| Cast | Behavior |
| --------------------------------------------- | --------------------------------------------------- |
| `boolean`, `bool` | Stores `1` / `0`, reads boolean |
| `number`, `integer`, `int`, `float`, `double` | Reads/writes numbers |
| `decimal:2` | Stores fixed precision string |
| `string` | Reads/writes string |
| `date`, `datetime` | Reads as `Date`, stores ISO string for `Date` input |
| `json`, `array`, `object` | Stores JSON string, reads parsed value |
| `enum` | Stores enum `.value` when present |
| `encrypted` | Base64 encodes on write and decodes on read |

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

### Attribute Accessors and Mutators

Use `static accessors` to transform attribute values on read (`get`) and write (`set`). Accessors and mutators run through both property access (`model.name`) and `getAttribute()` / `setAttribute()`.

```ts
class User extends Model {
  static table = "users";

  static accessors = {
    // Transform on read
    name: {
      get: (value: string) => value?.toUpperCase(),
    },

    // Transform on write
    email: {
      set: (value: string) => value?.toLowerCase().trim(),
    },

    // Both directions
    slug: {
      get: (value: string) => value?.replace(/-/g, " "),
      set: (value: string) => value?.toLowerCase().replace(/\s+/g, "-"),
    },
  };
}

const user = new User({ email: "  ALICE@Example.com  " });
user.$attributes.email; // "alice@example.com" — mutator ran on set

const found = await User.create({ name: "alice" });
found.name;               // "ALICE" — accessor ran on get
found.getAttribute("name"); // "ALICE" — same result
```

#### Computed (Virtual) Attributes

A `get` accessor with no corresponding database column works as a computed property derived from other attributes:

```ts
class User extends Model {
  static table = "users";

  static accessors = {
    full_name: {
      get: (_value: any, attributes: Record<string, any>) =>
        `${attributes.first_name ?? ""} ${attributes.last_name ?? ""}`.trim(),
    },
  };
}

const user = new User({ first_name: "Ada", last_name: "Lovelace" });
user.getAttribute("full_name"); // "Ada Lovelace"
(user as any).full_name;        // "Ada Lovelace" — via proxy
```

Computed accessors appear in `ownKeys` / `getOwnPropertyDescriptor` so they serialize correctly with `toJSON()`.

### CRUD

#### Creating & Finding

```ts
const all   = await User.all();                   // Collection<User>
const count = await User.count();
const user  = await User.create({ name: "Alice", email: "alice@example.com" });
const found = await User.find(1);
const first = await User.first();
const many  = await User.findMany([1, 2, 3]);
const admin = await User.firstWhere("role", "admin");

const selected = await User.whereKey([1, 3, 5]).get();
const others   = await User.whereKeyNot(1).get();

// Find-or-fail (throws if not found)
const user  = await User.findOrFail(1);
const first = await User.firstOrFail();
```

#### Saving & Deleting

```ts
// Property assignment
user.name = "Alice Smith";
await user.save();

// Fill multiple attributes at once
user.fill({ name: "Bob", email: "bob@example.com" });
await user.save();

// Fill and save in one call
await user.update({ name: "Bob", email: "bob@example.com" });

// Direct attribute access
user.getAttribute("name");
user.setAttribute("name", "Dana");

await user.delete();
await user.refresh();           // reload from database
await user.touch();             // update only timestamps
user.toJSON();                  // plain object: attributes + relations
user.json({ relations: false }); // attributes only
```

#### Quiet Operations (Skip Observers)

`saveQuietly()` and `deleteQuietly()` bypass all registered observers:

```ts
await user.saveQuietly();   // save without firing creating/updating/saving observers
await user.deleteQuietly(); // delete without firing deleting/deleted observers

// For bulk operations, pass { events: false }
await User.createMany(records, { events: false });
await User.saveMany(models, { events: false });
model.save({ events: false });
```

#### firstOrNew / firstOrCreate / updateOrInsert

```ts
// firstOrNew — find or instantiate (does NOT save automatically)
const user = await User.firstOrNew(
  { email: "alice@example.com" },  // search attributes
  { name: "Alice" },               // fill if not found
);
user.$exists;    // false if not found in DB
await user.save(); // persist when ready

// firstOrCreate — find or create (saves automatically)
const user = await User.firstOrCreate(
  { email: "alice@example.com" },
  { name: "Alice" },
);

// updateOrInsert — update existing record or create a new one
await User.updateOrInsert(
  { email: "alice@example.com" },  // match by these
  { name: "Alice Smith", active: true }, // set these
);
```

#### replicate

Clone a model without its primary key or timestamps — ready to save as a new record:

```ts
const copy = user.replicate();
copy.setAttribute("email", "copy@example.com");
await copy.save(); // new row, new ID

// Exclude additional fields from the clone
const partial = user.replicate(["email", "stripe_id"]);
```

#### forceCreate / truncate / withoutTimestamps

```ts
// forceCreate — bypass fillable guard, insert any column
const admin = await User.forceCreate({ name: "Root", internal_flag: true });

// truncate — delete all rows in the table
await User.truncate();

// withoutTimestamps — disable created_at / updated_at for one block
await User.withoutTimestamps(async () => {
  await User.create({ name: "No Timestamp" }); // timestamps not set
  await user.save();                            // updated_at not changed
});
```

#### Increment / Decrement

```ts
await user.increment("login_count");
await user.increment("login_count", 5, { last_login_at: new Date() }); // with extra columns
await user.decrement("stock", 10);
await User.where("active", false).decrement("score", 2); // bulk via query
```

### Lifecycle & State

#### $exists and $wasRecentlyCreated

```ts
const user = new User({ name: "Alice" });
user.$exists; // false — not yet saved

await user.save();
user.$exists; // true

const created = await User.create({ name: "Bob" });
created.$wasRecentlyCreated; // true — created in this request

const fetched = await User.find(created.getAttribute("id"));
fetched.$wasRecentlyCreated; // false — fetched, not created
```

#### wasChanged / getChanges

Track which attributes changed after the last `save()`:

```ts
user.setAttribute("name", "Updated");
await user.save();

user.wasChanged();         // true — at least one attribute changed
user.wasChanged("name");   // true
user.wasChanged("email");  // false
user.getChanges();         // { name: "Updated" }
```

#### is / isNot — Model Identity

Compare two model instances by their table and primary key:

```ts
const a = await User.find(1);
const b = await User.find(1);

a.is(b);    // true — same table, same primary key
a.isNot(b); // false
```

#### isDirty / getDirty

Check in-memory attributes that have not yet been saved:

```ts
user.setAttribute("name", "Pending");
user.isDirty();       // true
user.isDirty("name"); // true
user.getDirty();      // { name: "Pending" }
await user.save();
user.isDirty();       // false
```

### Bulk Operations

Bunny provides bulk methods for inserting, upserting, and creating multiple records efficiently. All bulk operations apply fillable rules, attribute casts, timestamps, and UUID key generation automatically.

#### insert / upsert

```ts
// insert — bulk insert with automatic processing (no model events)
await User.insert([
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob",   email: "bob@example.com" },
], { chunkSize: 500 }); // chunkSize batches large inserts

// insertOrIgnore — skip conflicting rows
await User.query().insertOrIgnore([
  { email: "alice@example.com" },
  { email: "existing@example.com" }, // skipped if it conflicts
]);

// upsert — insert or update on conflict
await User.upsert(
  [{ email: "alice@example.com", name: "Alice Updated" }],
  "email",    // unique key column
  ["name"],   // columns to update on conflict
  { chunkSize: 500 },
);

// Omit updateColumns to update all columns except the unique key
await User.upsert(
  [{ email: "alice@example.com", name: "Alice", active: true }],
  "email",
);
```

#### createMany / saveMany

```ts
// createMany — create multiple instances, fires model events
const users = await User.createMany([
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob",   email: "bob@example.com" },
]);
users[0].$exists; // true

// saveMany — save an array of new or existing instances
const p1 = new User({ name: "Alice" });
const p2 = new User({ name: "Bob" });
await User.saveMany([p1, p2]);

p1.$exists; // true

// Pass { events: false } to bypass all observers for either method
await User.createMany(records, { events: false });
await User.saveMany(models, { events: false });
```

### Serialization

Models serialize to plain objects with `toJSON()` and `json()`. Both include attributes and any eagerly loaded relations by default.

```ts
const user = await User.with("posts").first();

user.toJSON();
// { id: 1, name: "Alice", posts: [{ id: 1, title: "Hello" }, ...] }

user.json();                    // same as toJSON()
user.json({ relations: false }); // { id: 1, name: "Alice" } — attributes only
```

`toJSON()` is the standard JavaScript serialization hook, so `JSON.stringify(user)` will also include loaded relations.

#### Appended Attributes

Use `static appends` for computed attributes that should always appear in serialized output, or `append()` for one model instance. Appended attributes are typed on the returned instance so `json()` and `toJSON()` expose them to IntelliSense.

```ts
type UserAttrs = {
  id: number;
  first_name: string;
  last_name: string;
};

class User extends Model.define<UserAttrs>("users") {
  declare full_name: string;
  declare initials: string;

  static appends = ["full_name"];

  static accessors = {
    full_name: {
      get: (_value: unknown, attrs: UserAttrs) =>
        `${attrs.first_name} ${attrs.last_name}`.trim(),
    },
    initials: {
      get: (_value: unknown, attrs: UserAttrs) =>
        `${attrs.first_name[0] ?? ""}${attrs.last_name[0] ?? ""}`.toUpperCase(),
    },
  };
}

const user = await User.firstOrFail();

user.json().full_name; // string, included by static appends

const withInitials = user.append("initials");
withInitials.json().initials; // string, included for this instance

user.setAppends(["initials"]); // replace instance-level appends
user.getAppends();             // ["full_name", "initials"]
```

Visibility still applies to appended fields: `makeHidden("full_name")` removes the computed value from serialized output.

### Soft Deletes

Enable soft deletes with `static softDeletes = true` and a `deleted_at` column:

```ts
class User extends Model {
  static softDeletes = true;
}

await user.delete();        // sets deleted_at, row stays in DB
await user.restore();       // clears deleted_at
await user.forceDelete();   // permanently deletes

await User.all();               // excludes trashed rows automatically
await User.withTrashed().get(); // includes trashed rows
await User.onlyTrashed().get(); // only trashed rows
await User.onlyTrashed().restore(); // restore all trashed
```

### Scopes

#### Local Scopes

Local scopes are static methods named `scope{Name}`:

```ts
class User extends Model {
  static scopeActive(query: Builder<User>) {
    return query.where("active", true);
  }

  static scopeRole(query: Builder<User>, role: string) {
    return query.where("role", role);
  }
}

const users = await User.scope("active").get();
const admins = await User.scope("role", "admin").get();
```

#### Global Scopes

Global scopes apply automatically to all queries on a model:

```ts
User.addGlobalScope("tenant", (query) => {
  query.where("tenant_id", currentTenantId);
});

// Remove for a specific query
await User.withoutGlobalScope("tenant").get();
await User.withoutGlobalScopes().get(); // remove all global scopes
```

### Touches

Declare `static touches` on a model to automatically bump a parent relation's `updated_at` timestamp whenever the model is saved:

```ts
class Post extends Model {
  static touches = ["author"];

  author() {
    return this.belongsTo(User);
  }
}

// Saving a post will also update the related user's updated_at
await post.save();
```

Any relation name listed in `touches` is resolved, and `.touch()` is called on the result.

---

## Relationships

### hasMany

One record has many related records. The related table holds the foreign key.

```ts
// Schema
await Schema.create("users", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("posts", (t) => {
  t.increments("id");
  t.integer("user_id");   // foreign key pointing to users.id
  t.string("title");
  t.timestamps();
});

// Models
class User extends Model {
  static table = "users";
  posts() { return this.hasMany(Post); }              // FK: post.user_id
  posts() { return this.hasMany(Post, "author_id"); } // custom FK
}

class Post extends Model {
  static table = "posts";
}

// Usage
const posts = await user.posts().get();               // Collection<Post>
const post  = await user.posts().where("published", true).first();
```

### hasOne

One record has exactly one related record.

```ts
// Schema
await Schema.create("profiles", (t) => {
  t.increments("id");
  t.integer("user_id");   // foreign key pointing to users.id
  t.string("bio").nullable();
  t.timestamps();
});

// Model
class User extends Model {
  profile() { return this.hasOne(Profile); }
}

// Usage
const profile = await user.profile().get(); // Profile | null
```

#### hasOne — withDefault

Return a default model instance instead of `null` when the relation is missing:

```ts
class User extends Model {
  profile() {
    return this.hasOne(Profile).withDefault({ bio: "No bio yet" });
  }
}

// No profile row exists → returns an unsaved Profile with bio set
const profile = await user.profile().get();
profile.$exists;                // false
profile.getAttribute("bio");    // "No bio yet"

// withDefault() with no args returns an empty unsaved instance
this.hasOne(Profile).withDefault();
```

Default models are also used during eager loading — any model with a missing relation gets the default instead of `null`.

### belongsTo

The model holds the foreign key pointing to the parent.

```ts
// (re-uses the posts/users schema from hasMany above)

// Model
class Post extends Model {
  author() { return this.belongsTo(User); }              // FK: post.user_id
  author() { return this.belongsTo(User, "author_id"); } // custom FK
}

// Usage
const author = await post.author().get(); // User | null
```

#### Constrained relations

You can chain `where()` directly inside a relation method. The constraint stays attached to the relation, so lazy loading and eager loading both respect it. When the related column could be ambiguous, qualify it with the related table name.

```ts
class Customer extends Model {
  openInvoices() {
    return this.hasMany(Invoice).where("status", "open");
  }

  primaryContact() {
    return this.hasOne(Contact).where("kind", "primary");
  }

  accountOwner() {
    return this.belongsTo(User).where("users.active", true);
  }

  preferredTags() {
    return this.belongsToMany(Tag, "customer_tag")
      .where("tags.enabled", true);
  }

  coverImage() {
    return this.morphOne(Media, "attachable").where("role", "cover");
  }

  publicAssets() {
    return this.morphMany(Media, "attachable").where("visibility", "public");
  }
}

const customers = await Customer.with("openInvoices", "primaryContact").get();
const customer = customers[0];

const invoices = await customer
  .openInvoices()
  .where("total", ">", 100)
  .get();
```

#### belongsTo — associate / dissociate

Update the foreign key without touching the database directly:

```ts
const post = new Post({ title: "Draft" });
post.author().associate(user); // sets post.user_id = user.id (in memory)
await post.save();

post.author().dissociate();    // sets post.user_id = null (in memory)
await post.save();
```

#### belongsTo — withDefault

Return a default model instance instead of `null` when the FK is null or the parent is missing:

```ts
class Post extends Model {
  author() {
    return this.belongsTo(User).withDefault({ name: "Anonymous" });
  }
}

// FK is null → returns an unsaved User with name "Anonymous"
const author = await post.author().get();
author.$exists;                // false
author.getAttribute("name");   // "Anonymous"
```

### hasMany — create / saveMany / createMany

Persist related models via a `hasMany` relation. The FK is set automatically.

```ts
const user = await User.find(1);

// create — create a single model and return it
const post = await user.posts().create({ title: "My Post" });
post.$exists;                       // true
post.getAttribute("user_id");       // user.id

// saveMany — set FK and save each model instance
const p1 = new Post({ title: "First" });
const p2 = new Post({ title: "Second" });
await user.posts().saveMany([p1, p2]);

p1.$exists;                      // true
p1.getAttribute("user_id");      // user.id

// createMany — create and return multiple models
const posts = await user.posts().createMany([
  { title: "Alpha" },
  { title: "Beta" },
]);
posts[0].$exists;                // true
posts[0].getAttribute("user_id"); // user.id
```

### hasManyThrough / hasOneThrough

Access distant records through an intermediate model.

```ts
// Schema: countries → users → posts
await Schema.create("countries", (t) => {
  t.increments("id");
  t.string("name");
});
await Schema.create("users", (t) => {
  t.increments("id");
  t.integer("country_id");
  t.string("name");
  t.timestamps();
});
await Schema.create("posts", (t) => {
  t.increments("id");
  t.integer("user_id");
  t.string("title");
  t.timestamps();
});

// Models
class Country extends Model {
  posts() {
    return this.hasManyThrough(Post, User);
    // intermediate FK: users.country_id
    // final FK:        posts.user_id
  }

  latestPost() {
    return this.hasOneThrough(Post, User);
  }
}

// Usage
const posts = await country.posts().get(); // all posts by users in this country

// Override keys: hasManyThrough(Final, Through, throughFK, finalFK, localKey, throughKey)
this.hasManyThrough(Post, User, "country_uuid", "author_id", "uuid", "id");
```

### belongsToMany (Many-to-Many)

Two models are linked through a pivot table.

```ts
// Schema
await Schema.create("users", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("roles", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("role_user", (t) => { // pivot: alphabetical model names
  t.integer("user_id");
  t.integer("role_id");
});

// Models
class User extends Model {
  roles() { return this.belongsToMany(Role); }
}

class Role extends Model {
  users() { return this.belongsToMany(User); }
}

// Usage
const roles = await user.roles().get(); // Collection<Role>
```

Bunny infers the pivot table name by sorting model names alphabetically: `role_user` for `Role` + `User`.

You can also pass a pivot model as the second argument. In that form Bunny uses the pivot model's table name and still infers the pivot keys from the parent and related model names:

```ts
class Section extends Model {
  static table = "sections";

  students() {
    return this.belongsToMany(Student, Offering);
  }
}

class Student extends Model {
  static table = "students";
}

class Offering extends Model {
  static table = "offerings";
}
```

This uses `offerings` as the pivot table, `section_id` as the parent pivot key, and `student_id` as the related pivot key.

#### Pivot Columns and Timestamps

```ts
// Select specific columns from the pivot table
class User extends Model {
  roles() {
    return this.belongsToMany(Role)
      .withPivot("is_active", "expires_at")
      .withTimestamps(); // also select pivot created_at / updated_at
  }
}

const roles = await user.roles().get();
roles[0].pivot.is_active;  // pivot data attached to each related model
roles[0].pivot.expires_at;
roles[0].pivot.created_at;
```

#### Renaming the Pivot Accessor

Use `.as()` to rename `.pivot` to something more descriptive:

```ts
class User extends Model {
  subscriptions() {
    return this.belongsToMany(Plan)
      .as("subscription")
      .withPivot("expires_at", "trial_ends_at");
  }
}

const plans = await user.subscriptions().get();
plans[0].subscription.expires_at; // renamed from .pivot
```

#### Attaching, Detaching & Syncing

```ts
// Attach — add rows to the pivot table
await user.roles().attach([1, 2, 3]);
await user.roles().attach(1, { is_active: true }); // with pivot attributes

// Detach — remove rows from the pivot table
await user.roles().detach([2, 3]);
await user.roles().detach(); // detach all

// Sync — keep only the given IDs (detaches all others)
await user.roles().sync([1, 2]);

// syncWithoutDetaching — add new IDs, never remove existing ones
await user.roles().syncWithoutDetaching([3, 4]);
```

#### Creating and saving through a relation

`belongsToMany()` and `morphToMany()` can also create or save related models directly. Any fixed `where()` constraints are applied to the related model before save, and any fixed `wherePivot()` constraints are injected into the pivot row.

```ts
class Post extends Model {
  featuredTags() {
    return this.belongsToMany(Tag, "post_tag")
      .withPivot("type")
      .where("name", "Featured")
      .wherePivot("type", "featured");
  }
}

const post = await Post.first();
if (!post) return;

await post.featuredTags().create({ name: "Ignored" });

const tag = new Tag({ name: "Ignored" });
await post.featuredTags().save(tag);

await post.featuredTags().createMany([
  { name: "Ignored 1" },
  { name: "Ignored 2" },
]);

await post.featuredTags().saveMany([
  new Tag({ name: "Ignored 3" }),
  new Tag({ name: "Ignored 4" }),
]);
```

The constrained fields do not appear in IntelliSense for the create helpers, because Bunny fills them from the relation itself.

#### Updating Existing Pivot Rows

Update pivot columns for a specific related record without detaching and re-attaching:

```ts
await user.roles().updateExistingPivot(roleId, {
  is_active: false,
  expires_at: "2025-12-31",
});
```

#### Toggle

Attach IDs that aren't attached, detach IDs that are. Returns the lists of what changed:

```ts
const result = await user.roles().toggle([1, 2, 3]);
result.attached; // IDs that were newly attached
result.detached; // IDs that were removed

await user.roles().toggle(4); // single ID
```

#### Filtering by Pivot Columns

```ts
const active  = await user.roles().wherePivot("is_active", true).get();
const heavy   = await user.skills().wherePivot("weight", ">", 5).get();
const mixed   = await user.skills()
  .wherePivot("weight", ">", 5)
  .orWherePivot("featured", true)
  .get();
const some    = await user.roles().wherePivotIn("priority", [1, 2]).get();
const others  = await user.roles().wherePivotNotIn("priority", [3, 4]).get();
const unset   = await user.tags().wherePivotNull("expires_at").get();
const expiring = await user.tags().wherePivotNotNull("expires_at").get();
const ranked  = await user.skills().wherePivotBetween("weight", [5, 10]).get();
const flagged = await user.roles()
  .wherePivot("priority", 1)
  .orWherePivotIn("priority", [2, 3])
  .orWherePivotNull("priority")
  .get();
```

Use `withPivotValue()` when a relation should always read and write a fixed pivot value. The value is applied as a pivot filter and is also injected into `attach()`, `sync()`, `save()`, and `create()` pivot rows:

```ts
class User extends Model {
  primaryRoles() {
    return this.belongsToMany(Role).withPivotValue("scope", "primary");
  }
}

await user.primaryRoles().attach(role.id); // pivot.scope = "primary"
const roles = await user.primaryRoles().get(); // only scope = "primary"
```

Pivot filters are also preserved in constrained eager loading. For `belongsToMany` and `morphToMany` relations, the eager-load callback receives a pivot-aware builder, so pivot helpers work there too:

```ts
const users = await User.with({
  roles: (q) => q
    .wherePivot("is_active", true)
    .wherePivotNotNull("approved_at"),
}).get();
```

### One-of-Many

Convert a `hasMany` into a single "latest", "oldest", or aggregate-selected record:

```ts
class User extends Model {
  posts() { return this.hasMany(Post); }

  latestPost()          { return this.posts().latestOfMany("id"); }
  oldestPost()          { return this.posts().oldestOfMany("id"); }
  highestScoringPost()  { return this.posts().ofMany("score", "max"); }
}

const post = await user.latestPost().get(); // Post | null
```

### Eager Loading

#### with() — Load Relations Upfront

```ts
// Load one or more relations
const users = await User.with("posts", "profile").get();
const posts = await Post.with("author").get();

// Nested relations via dot notation
const users = await User.with("posts.comments").get();

// Constrained eager loading — filter within the loaded relation
const users = await User.with({
  posts: (q) => q.where("status", "published").orderBy("created_at", "desc"),
}).get();

// Pivot-aware eager loading — available on belongsToMany / morphToMany relations
const sections = await Section.with({
  subjects: (q) => q.wherePivot("semester_id", params.semester_id),
}).get();

// Nested constraint — the callback is typed to the model at the end of the path
const semesters = await Semester.with({
  "sections.offerings.registrationSubjects": (q) =>
    q.where("enrolled", true).with("subject"),
}).get();

// Multiple constraints combined
const users = await User.with(
  { posts: (q) => q.where("status", "published") },
  { "posts.comments": (q) => q.where("approved", true) },
).get();
```

#### load() — Lazy Load on Existing Model

```ts
await user.load("posts");

// With constraint
await user.load({
  posts: (query) => query.where("status", "published"),
});
```

#### Typed Eager Load Results

When models use `Model.define<T>()`, relation names autocomplete and results are fully typed:

```ts
// All of these autocomplete and are type-checked:
Semester.with("sections");
Semester.with("sections.offerings");
Semester.with("sections.offerings.subjects");

// After eager loading, the relation type narrows automatically
const years = await AcademicCalendar
  .with("semesters", "semesters.gradingPeriods")
  .get();

years[0].semesters;                   // Collection<Semester>  ✓
years[0].semesters[0].gradingPeriods; // Collection<GradingPeriod>  ✓
```

Without `with()`, `years[0].semesters` stays as `() => HasMany<Semester>` (the relation method).

| Relation type | Loaded type |
|--------------------|------------------------|
| `hasMany` | `Collection<R>` |
| `belongsToMany` | `Collection<R>` |
| `morphMany` | `Collection<R>` |
| `morphToMany` | `Collection<R>` |
| `hasOne` | `R \| null` |
| `belongsTo` | `R \| null` |
| `morphOne` | `R \| null` |

### Relation Queries

#### has / doesntHave

Filter parent models by whether a relation exists:

```ts
const usersWithPosts    = await User.has("posts").get();
const usersWithoutPosts = await User.doesntHave("posts").get();
```

#### whereHas / orWhereHas / whereDoesntHave

Filter by related record properties:

```ts
const usersWithPublished = await User.whereHas("posts", (q) => {
  q.where("status", "published");
}).get();

const usersWithPublishedOrFeatured = await User
  .whereHas("posts", (q) => q.where("status", "published"))
  .orWhereHas("posts", (q) => q.where("featured", true))
  .get();

const usersWithoutSpam = await User.whereDoesntHave("posts", (q) => {
  q.where("spam", true);
}).get();
```

The same pivot-aware callback behavior applies to `whereHas()` and `whereDoesntHave()` when the relation is a `belongsToMany` or `morphToMany`.

#### withExists

Add a relation-exists field. The alias is included as `boolean` in model JSON and paginated JSON types:

```ts
const pageResult = await Subject
  .withExists("offerings", "in_used", (offering) => {
    offering.has("admissions");
  })
  .whereNull("parent_id")
  .orderBy("title")
  .paginate(15, 1);

const json = pageResult.json();
json.data[0].in_used; // boolean

// Example record:
json.data[0];
// {
//   id: 1,
//   title: "Mathematics",
//   parent_id: null,
//   in_used: true
// }
```

Supported forms:

```ts
Subject.withExists("offerings");
// adds: offerings_exists: boolean

Subject.withExists("offerings", (offering) => offering.has("admissions"));
// adds: offerings_exists: boolean

Subject.withExists("offerings", "in_used", (offering) => offering.has("admissions"));
// adds: in_used: boolean

Subject.withExists({
  offerings: (offering) => offering.has("admissions"),
  "offerings as in_used": (offering) => offering.has("admissions"),
});
// adds: offerings_exists: boolean, in_used: boolean
```

#### whereRelation / orWhereRelation

Shorthand for `whereHas` when you just need to check one column on the related model:

```ts
// Posts that have at least one approved comment
const posts = await Post.whereRelation("comments", "status", "approved").get();

// With operator
const posts = await Post.whereRelation("comments", "votes", ">", 10).get();

// OR variant
const posts = await Post
  .whereRelation("comments", "status", "approved")
  .orWhereRelation("comments", "status", "featured")
  .get();
```

#### whereBelongsTo / whereAttachedTo

Use model instances as relation filters without spelling out foreign keys or pivot joins:

```ts
class Post extends Model {
  author() {
    return this.belongsTo(User, "author_id");
  }

  tags() {
    return this.belongsToMany(Tag, "post_tag");
  }
}

const author = await User.where("email", "ada@example.com").first();
if (!author) return;

// Posts whose author() belongsTo the given user.
const posts = await Post.whereBelongsTo("author", author).get();
```

`whereAttachedTo()` works with `belongsToMany()` and `morphToMany()` relations. Pivot constraints, morph constraints, and related-model constraints defined on the relation still apply because the shortcut uses the relation existence query:

```ts
const tag = await Tag.where("slug", "release-notes").first();
if (!tag) return;

const taggedPosts = await Post.whereAttachedTo("tags", tag).get();

// Multiple related models are supported too.
const selectedTags = await Tag.whereIn("slug", ["release-notes", "guide"]).get();
const posts = await Post.whereAttachedTo("tags", selectedTags).get();

// It also works in the middle of a query chain.
const publishedTaggedPosts = await Post.query()
  .whereAttachedTo("tags", tag)
  .where("status", "published")
  .latest()
  .get();
```

The first argument is always the relationship name and is typed for IntelliSense: `whereBelongsTo()` suggests only `belongsTo` relations, while `whereAttachedTo()` suggests only `belongsToMany` and `morphToMany` relations. The related model or collection is required as the second argument.

#### withWhereHas

Filter parent models and eager load the filtered relation in one call:

```ts
// Only users who have published posts — and also load those posts
const users = await User.withWhereHas("posts", (q) =>
  q.where("status", "published")
).get();

users[0].getRelation("posts"); // only published posts, already loaded
```

#### Relation Aggregates

Add aggregate columns from a relation without loading the related records:

```ts
const users = await User
  .withCount("posts")
  .withSum("posts", "views")
  .withAvg("posts", "score")
  .withMin("posts", "created_at")
  .withMax("posts", "created_at")
  .get();

users[0].posts_count;     // number of posts
users[0].posts_sum_views; // sum of views across all posts
```

Aggregate methods support constrained subqueries with the same relation-aware callback style:

```ts
const users = await User
  .withAvg("posts", "score", (post) =>
    post.where("status", "published")
  )
  .withMax("posts", "created_at", "latest_published_post_at", (post) =>
    post.where("status", "published")
  )
  .get();

users[0].posts_avg_score;          // average score for published posts
users[0].latest_published_post_at; // max created_at for published posts
```

Supported aggregate overloads:

```ts
User.withAvg("posts", "score");
User.withAvg("posts", "score", (post) => post.where("status", "published"));
User.withAvg("posts", "score", "published_score_avg");
User.withAvg("posts", "score", "published_score_avg", (post) =>
  post.where("status", "published")
);
```

The same overloads are available for `withSum`, `withMin`, and `withMax`. The relation name autocompletes from model relations, and the column argument autocompletes from the related model.

#### loadMissing — Lazy Load Missing Relations on a Collection

Load relations for collection items that don't have them yet. Already-loaded relations are preserved:

```ts
const posts = await Post.where("status", "published").get();
// posts[0].getRelation("author") === undefined — not loaded yet

await posts.loadMissing("author", "comments");

posts[0].getRelation("author");   // User — now loaded
posts[0].getRelation("comments"); // Collection<Comment> — now loaded

// Safe to call multiple times — only triggers queries for truly missing relations
posts[0].setRelation("author", sentinel);
await posts.loadMissing("author"); // author is already set, skipped
```

#### Post-retrieval Aggregate Loaders

Load relation aggregates after you already have a model or collection:

```ts
const user = await User.first();
if (!user) return;

await user.loadCount("posts");
await user.loadSum("posts", "views", "total_views");
await user.loadAvg("posts", "score");
await user.loadMin("posts", "created_at");
await user.loadMax("posts", "created_at", "latest_post_at");

const users = await User.where("active", true).get();
await users.loadCount("posts");
```

The loaders mutate the model(s) in place and return the same value with the aggregate fields attached. The relation name and related columns are typed, so IntelliSense follows the model relation and the related model columns.

Assumptions for IntelliSense:

- Use the awaited return value if you want the aggregate fields available on a local variable type.
- Guard nullable lookups like `await User.first()` before calling the loaders.
- The generated field names follow the same default aliases as `withCount()`, `withSum()`, `withAvg()`, `withMin()`, and `withMax()`.

### Polymorphic Relations

```ts
import { Model, MorphMap } from "@bunnykit/orm";

// Schema
await Schema.create("comments", (t) => {
  t.increments("id");
  t.string("commentable_type"); // e.g. "Post" or "Video"
  t.integer("commentable_id");
  t.text("body");
  t.timestamps();
});

// Register morph types so morphTo knows which model to instantiate
MorphMap.register("Post", Post);
MorphMap.register("Video", Video);

class Comment extends Model {
  commentable() {
    return this.morphTo("commentable"); // reads commentable_type / commentable_id
  }
}

class Post extends Model {
  comments() { return this.morphMany(Comment, "commentable"); }
}

class Video extends Model {
  comments()   { return this.morphMany(Comment, "commentable"); }
  thumbnail()  { return this.morphOne(Image, "imageable"); }
}

// Usage
const comments = await Comment.with("commentable").get();
comments[0].getRelation("commentable"); // Post | Video | null

const postComments = await post.comments().get(); // Collection<Comment>
```

#### Creating morph records

`morphMany()` and `morphOne()` relations can create records directly through the relation. The morph columns are filled automatically, and any fixed `where()` constraints are excluded from the input type and applied for you at write time.

```ts
const student = await Student.first();
if (!student) return;

await student.attachments().attach({
  filename: "transcript.pdf",
});

await student.attachments().attachMany([
  { filename: "id-card-front.jpg" },
  { filename: "id-card-back.jpg" },
]);

await student.profilePicture().attach({
  filename: "profile.jpg",
});
```

For `profilePicture()`, `collection` is injected from the relation constraint, so it does not appear in IntelliSense. Also avoid optional chaining on the relation call itself if you want method autocomplete; guard the model first, as above.

#### Morph-to query helpers

`whereHasMorph()` and `whereDoesntHaveMorph()` let you filter a `morphTo` relation by the concrete types it can point to. The callback receives the related model query for each type. For eager loading, the `with()` callback receives the `MorphTo` relation itself, so `morphWith()` and `morphWithCount()` are available in IntelliSense.

```ts
const comments = await Comment.whereHasMorph(
  "commentable",
  [Post, Video],
  (query) => {
    query.where("title", "Morph target");
  },
).get();

const missingVideos = await Comment.whereDoesntHaveMorph("commentable", [Video]).get();

const post = await Post.firstOrFail();

const onThisPost = await Comment
  .whereMorphedTo("commentable", post)
  .get();

const onAnyPost = await Comment
  .whereMorphedTo("commentable", Post)
  .get();

const notThisPost = await Comment
  .whereNotMorphedTo("commentable", post)
  .get();

const postOrVideo = await Comment
  .whereMorphedTo("commentable", post)
  .orWhereMorphedTo("commentable", "Video")
  .get();

const loaded = await Comment.with({
  commentable: (relation) =>
    relation
      .morphWith({
        Post: ["comments"],
        Video: ["thumbnail"],
      })
      .morphWithCount({
        Post: ["comments"],
      }),
}).get();

await loaded.loadMorph("commentable", {
  Post: ["comments"],
  Video: ["thumbnail"],
});
```

Assumptions for IntelliSense:

- `morphWith()` and `morphWithCount()` are only available inside the `with({ commentable: (relation) => ... })` callback, because that callback is typed as the `MorphTo` relation.
- `whereHasMorph()` and `whereDoesntHaveMorph()` callbacks are typed to the related model query, so builder methods are available there instead.
- `whereMorphedTo()`, `orWhereMorphedTo()`, and `whereNotMorphedTo()` only accept typed `morphTo` relation names. Passing an instance filters by both morph type and ID; passing a model class or morph type string filters by type.
- `loadMorph()` is available on `Model` instances and collections, and the morph relation name should be one of the model's typed morph relations.
- Fixed relation fields stay out of write-input IntelliSense when Bunny injects them from the relation itself.

### Customizing Morph Type

```ts
class Post extends Model {
  static morphName = "post"; // stored in {name}_type column as "post" instead of "Post"
}
```

### Many-to-Many Polymorphic

```ts
// Schema
await Schema.create("tags", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("taggables", (t) => {
  t.integer("tag_id");
  t.integer("taggable_id");
  t.string("taggable_type"); // "Post", "Video", etc.
});

// Models
class Post extends Model {
  tags() { return this.morphToMany(Tag, "taggable"); }

  importantTags() {
    return this.morphToMany(Tag, "taggable")
      .withPivot("scope")
      .where("name", "Important")
      .wherePivot("scope", "important");
  }
}

class Tag extends Model {
  posts()  { return this.morphedByMany(Post, "taggable"); }
  videos() { return this.morphedByMany(Video, "taggable"); }
}

// Usage
const tags = await post.tags().get();       // Collection<Tag>
const posts = await tag.posts().get();      // Collection<Post>

const post = await Post.first();
if (!post) return;

await post.importantTags().create({ name: "Ignored" });
await post.importantTags().save(new Tag({ name: "Ignored" }));
```

`morphToMany()` supports the same `create`, `createMany`, `save`, and `saveMany` helpers as `belongsToMany()`. Relation constraints are applied automatically, and constrained fields stay out of IntelliSense for the write input.

---

## Database Transactions

Wrap multiple operations in a transaction to ensure all-or-nothing execution.

### Automatic (Recommended)

Pass a callback to `transaction()`. It commits on success and rolls back automatically if the callback throws:

```ts
const connection = Post.getConnection();

await connection.transaction(async (tx) => {
  await tx.run(`INSERT INTO posts (title, created_at, updated_at)
                VALUES ('First', datetime('now'), datetime('now'))`);
  await tx.run(`INSERT INTO posts (title, created_at, updated_at)
                VALUES ('Second', datetime('now'), datetime('now'))`);
  // if any line throws, both inserts are rolled back
});
```

### Manual

Control `begin`, `commit`, and `rollback` directly:

```ts
const connection = Post.getConnection();

await connection.beginTransaction();
try {
  await connection.run(`INSERT INTO posts (title, created_at, updated_at)
                        VALUES ('Manual', datetime('now'), datetime('now'))`);
  await connection.commit();
} catch (err) {
  await connection.rollback();
  throw err;
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
const model      = users.make();
const created    = await users.count(3).state({ role: "admin" }).create();
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

## TypeScript

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
  posts()   { return this.hasMany(Post); }
  profile() { return this.hasOne(Profile); }
}

// Attribute access
const user = await User.find(1);
user.name;   // string
user.email;  // string | null
user.active; // boolean

// Column autocomplete in query builder
User.where("email", "alice@example.com");  // ✓
User.orderBy("created_at", "desc");         // ✓
User.where("nonexistent", "x");             // ✗ TS error

// with() autocomplete
User.with("posts");           // ✓
User.with("posts.comments");  // ✓ nested
User.with("nonexistent");     // ✗ TS error

// Typed eager-load results
const users = await User.with("posts").get();
users[0].posts; // Collection<Post>
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
user.name;  // ✅ autocomplete + type-checking
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

| Table | Model file | No prefix (relative) | With `typeDeclarationImportPrefix: "$models"` |
| ------------ | ------------------------------ | ----------------------- | --------------------------------------------- |
| `users` | `src/models/User.ts` | `../User` / `User` | `$models/User` / `User` |
| `blog_posts` | `src/models/BlogPost.ts` | `../BlogPost` / `BlogPost` | `$models/BlogPost` / `BlogPost` |
| `tenants` | `src/models/landlord/tenant.ts`| `../landlord/tenant` / `Tenant` | `$models/landlord/tenant` / `Tenant` |

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
user.name; // string — direct property access, no getAttribute() needed
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

472 tests covering connection management, schema grammars, query builder, collections, model CRUD, casts, scopes, soft deletes, relations, observers, migrations, type generation, lazy eager loading, find-or-fail, first-or-create, increment/decrement, touch, chunk/cursor/lazy/chunkById/lazyById streaming, pagination variants, date where clauses, conditional query building, whereKey/whereKeyNot/findMany/firstWhere, static model query helper proxies, whereNot, latest/oldest, or\* where variants, having/orHaving, orderByDesc/reorder/orderByRaw/groupByRaw, crossJoin, union, insertOrIgnore, upsert, delete with limit, skipLocked/noWait, JSON where clauses, like/regexp/fulltext, whereAll/whereAny, sole/value, selectRaw/fromSub, updateFrom, dump/dd, explain, attribute accessors/mutators, appends/append serialization, is()/isNot(), wasRecentlyCreated, toggle(), pivot query helpers, replicate(), wasChanged(), saveQuietly(), deleteQuietly(), firstOrNew(), forceCreate(), truncate(), withoutTimestamps(), updateExistingPivot(), syncWithoutDetaching(), as(), withDefault(), whereRelation(), whereBelongsTo(), whereAttachedTo(), whereMorphedTo(), withWhereHas(), touches, database transactions, Collection.loadMissing(), post-retrieval aggregate loaders, HasMany.saveMany(), and HasMany.createMany().

---

## License

MIT
