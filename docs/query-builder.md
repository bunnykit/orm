# Query Builder

The query builder is a chainable, type-safe wrapper around SQL. Every model exposes it through static methods (`User.where(...)`, `Post.with(...)`). You can also use it directly without a model through the [`DB` facade](#the-db-facade) — handy for ad-hoc table access, reporting views, and pivot tables that don't warrant their own class.

Everything in this document works the same against SQLite, MySQL, and PostgreSQL — Bunny translates to the right dialect.

```ts
import { User, Post, DB } from "@bunnykit/orm";
```

## Quick reference

```ts
const users = await User
  .where("active", true)
  .whereNotIn("role", ["banned", "spam"])
  .with("posts")
  .withCount("comments")
  .orderByDesc("created_at")
  .paginate(20);
```

Most chains follow the same shape: filter, eager-load, order, then terminate with `.get()`, `.first()`, `.paginate()`, `.count()`, etc.

## The `DB` facade

`DB.table()` gives you a builder against any table without a model class. Useful for:

- Tables that exist only as join / pivot tables.
- One-off analytics or reporting queries.
- Migrating or backfilling data where a model would be overkill.
- Scripts that need raw row shapes.

```ts
import { DB } from "@bunnykit/orm";

const rows = await DB.table("users")
  .where("active", true)
  .orderBy("created_at", "desc")
  .select("id", "name", "email")
  .get(); // Record<string, any>[]

const count = await DB.table("audit_logs").where("event", "login").count();

await DB.table("settings").where("key", "theme").update({ value: "dark" });

// Raw SQL
const rows = await DB.raw("SELECT * FROM users WHERE id = ?", [1]);
```

### Typed columns (IntelliSense)

Pass a row-shape generic to get column autocomplete on `where`, `select`, `update`, and typed result rows:

```ts
interface UserRow {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

const rows = await DB.table<UserRow>("users")
  .where("active", true)    // "active" autocompletes
  .select("id", "name")     // column names autocomplete
  .get();                   // rows: UserRow[]

// Reuse model attribute interfaces
import type { UserAttributes } from "./models/User";
await DB.table<UserAttributes>("users").where("email", "a@b.com").first();

// Typed raw SQL
const stats = await DB.raw<{ total: number }>("SELECT COUNT(*) as total FROM users");
stats[0].total; // number
```

Omit the generic for `Record<string, any>` rows.

### Named connections

When you operate against multiple databases (primary + analytics, read replica, archive), register them and route queries explicitly:

```ts
import { Connection, ConnectionManager } from "@bunnykit/orm";

ConnectionManager.add("analytics", new Connection({ url: "postgres://analytics-db" }));

await DB.connection("analytics").table("events").where("type", "view").count();
```

`DB.connection(name)` throws if the name is not registered — fail fast instead of silently falling through to the default.

### Multi-tenant scope

`DB.tenant(tenantId, fn)` wraps [`TenantContext.run`](./configuration.md#tenancy). All queries inside (both Models and `DB.table()`) resolve against the tenant's connection or schema:

```ts
await DB.tenant("acme", async () => {
  const users = await User.all();                          // tenant_acme scope
  const orders = await DB.table("orders").get();           // tenant_acme scope
  await DB.table("audit_logs").insert({ event: "login" }); // tenant_acme scope
});
```

Works with all three tenancy strategies (database-per-tenant, schema-per-tenant, RLS) configured via `ConnectionManager.setTenantResolver()`.

**Context switching.** Tenant scope is tracked with `AsyncLocalStorage`, so it propagates across `await` boundaries and behaves predictably under nesting and concurrency:

```ts
import { TenantContext } from "@bunnykit/orm";

// Nested contexts override the outer scope and restore on unwind.
await DB.tenant("acme", async () => {
  TenantContext.current()?.tenantId; // "acme"

  await DB.tenant("globex", async () => {
    TenantContext.current()?.tenantId; // "globex"
  });

  TenantContext.current()?.tenantId; // "acme" — restored
});

TenantContext.current(); // undefined — fully unwound

// Parallel tenants do not bleed into one another.
await Promise.all([
  DB.tenant("a", async () => User.all()),
  DB.tenant("b", async () => User.all()),
  DB.tenant("c", async () => User.all()),
]);
```

Each concurrent `DB.tenant()` runs in its own async storage frame.

## Reading rows

### Basic terminators

```ts
const all = await User.all();                                // every row
const found = await User.find(1);                            // by primary key, or null
const first = await User.first();                            // first row in default order
const user = await User.where("email", "a@b.com").first();   // first matching row
const users = await User.where("active", true).get();        // Collection<User>
const arr = await User.where("active", true).getArray();     // plain User[]
```

`get()` returns a [Collection](./collections.md) with helpers like `map`, `filter`, `groupBy`. Use `getArray()` if you only need a plain array (e.g. for `Response.json` payloads).

### Throw-on-miss variants

These raise `ModelNotFoundError` when there's no row:

```ts
const user = await User.findOrFail(1);
const first = await User.firstOrFail();
```

`sole()` is stricter — throws if there are zero **or** more than one match:

```ts
const alice = await User.where("email", "alice@example.com").sole();
```

Use `sole()` to enforce uniqueness assumptions (one row per email, etc.) and surface data integrity bugs early.

### Scalars and projections

```ts
const name = await User.where("id", 1).value("name");      // single column from first row
const emails = await User.pluck("email");                  // string[] — one column from every row
const idsByEmail = await User.pluck("email", "id");        // Record<id, email>
```

## Where clauses

### Equality and operators

```ts
User.where("active", true);
User.where("age", ">=", 18);
User.where({ role: "admin", active: true });               // object shorthand AND
```

Pass a callback to build a nested group (`WHERE (…)`):

```ts
// WHERE active = true AND (role = 'admin' OR role = 'mod')
User.where("active", true).where((q) =>
  q.where("role", "admin").orWhere("role", "mod"),
);
```

### Sets, ranges, null

```ts
User.whereNot("status", "banned");                         // !=
User.whereIn("role", ["admin", "mod"]);
User.whereNotIn("status", ["banned", "spam"]);
User.whereNull("deleted_at");
User.whereNotNull("email");
User.whereBetween("age", [18, 65]);
User.whereNotBetween("score", [0, 10]);
```

Each has an `or*` counterpart:

```ts
User.where("role", "admin").orWhere("role", "mod");
User.where("a", 1).orWhereIn("role", ["x", "y"]);
User.where("a", 1).orWhereNull("email");
```

### Columns, raw, EXISTS

```ts
// Compare two columns
User.whereColumn("updated_at", ">", "created_at");

// Raw SQL fragment
User.whereRaw("LENGTH(name) > 10");

// Subquery EXISTS / NOT EXISTS
User.whereExists("SELECT 1 FROM orders WHERE orders.user_id = users.id");
User.whereNotExists("SELECT 1 FROM bans WHERE bans.user_id = users.id");
```

### Date parts

Cross-database — Bunny emits the right `EXTRACT`, `DATE_FORMAT`, or `strftime` per driver:

```ts
Event.whereDate("happened_at", "2024-01-01");
Event.whereYear("created_at", ">=", 2023);
Event.whereMonth("birthday", 12);
Event.whereDay("anniversary", 14);
Event.whereTime("opened_at", "09:00:00");
```

### JSON

```ts
User.whereJsonContains("settings", { theme: "dark" });
User.whereJsonLength("tags", ">", 2);
```

On Postgres these compile to `@>` / `jsonb_array_length`. On MySQL they use `JSON_CONTAINS` / `JSON_LENGTH`. SQLite uses the `json1` extension (built into Bun).

### Pattern matching

```ts
User.whereLike("name", "Ali%");
User.whereNotLike("name", "Bot%");
User.whereRegexp("email", "^alice");
User.whereFullText(["bio", "summary"], "laravel orm");
```

`whereFullText` uses Postgres `tsvector`, MySQL `MATCH … AGAINST`, and SQLite FTS5 — pick column types accordingly when designing your schema.

### Multi-column

```ts
User.whereAll(["first_name", "last_name"], "like", "%smith%");  // every col matches
User.whereAny(["email", "phone"], "like", "%example%");         // any col matches
```

### Primary-key shortcuts

```ts
User.whereKey(1);                  // WHERE id = 1
User.whereKey([1, 2, 3]);          // WHERE id IN (1,2,3)
User.whereKeyNot(99);              // WHERE id != 99
```

Useful in scopes and policies — they read better than `where("id", …)` and adapt automatically if a model overrides `primaryKey`.

## Ordering, grouping, limiting

```ts
User.orderBy("name", "asc");
User.orderByDesc("created_at");
User.latest();                     // orderBy(created_at, desc)
User.latest("published_at");
User.oldest();                     // orderBy(created_at, asc)
User.inRandomOrder();              // RANDOM() / RAND() — use sparingly on large tables
User.orderBy("name").reorder();    // clear orders
User.orderBy("name").reorder("id"); // replace
```

```ts
User.limit(10).offset(20);
User.take(10).skip(20);            // aliases
User.forPage(3, 15);               // offset 30, limit 15
```

```ts
User.groupBy("role");
User.groupBy("role").having("count", ">", 1);
User.groupBy("role").havingRaw("COUNT(*) > 1");
```

## Joins

```ts
const posts = await Post.query()
  .select("posts.*", "users.name as author_name")
  .join("users", "posts.user_id", "=", "users.id")
  .leftJoin("comments", "comments.post_id", "=", "posts.id")
  .crossJoin("tags")
  .get();
```

For a relation-aware filter, prefer [`whereHas`](./relationships.md#querying-relations) over manual joins — it composes with eager loading and respects soft deletes.

## Unions

```ts
const active = User.where("active", true);
const admin = User.where("role", "admin");

const distinct = await active.union(admin).get();    // dedupes
const all = await active.unionAll(admin).get();      // keeps duplicates
```

## Aggregates

```ts
await User.where("active", true).count();
await User.where("email", "test@example.com").exists();
await User.where("email", "missing@example.com").doesntExist();
await Order.sum("amount");
await Order.avg("amount");
await Product.min("price");
await Product.max("price");
```

`exists()` runs a tiny `SELECT 1` and short-circuits — prefer it to `count() > 0` when you only need a boolean.

## Eager loading

The fastest way to avoid N+1 query bugs. Always pre-load relations you intend to read.

```ts
const posts = await Post.with("author", "comments").get();
for (const post of posts) {
  post.author.name;          // no extra query
  post.comments.length;      // no extra query
}
```

### Nested and constrained

```ts
// Nested: posts → comments → author
const posts = await Post.with("comments.author").get();

// Constrain a relation's query (filter, select, order)
const users = await User.with({
  posts: (q) => q.where("published", true).orderByDesc("created_at"),
}).get();

// Nest deeply
const users = await User.with({
  "posts.comments": (q) => q.whereNull("flagged_at"),
}).get();
```

### Relation aggregates

These don't load the related rows; they emit extra scalar columns:

```ts
await User.withCount("posts").get();
// → user.posts_count: number

await Order.withSum("items", "price").get();
// → order.items_sum_price: number

await User.withMin("posts", "score").get();
await User.withMax("posts", "score").get();
await User.withAvg("posts", "rating").get();

// Conditional + aliased
await User.withCount({
  posts: (q) => q.where("published", true),
  drafts: (q) => q.where("published", false),
}).get();
// → user.posts_count, user.drafts_count
```

### Boolean existence

`withExists` adds a typed boolean column without hydrating the relation:

```ts
await User.withExists("posts").get();
// → user.posts_exists: boolean
```

### Filter + eager load in one call

```ts
await User.withWhereHas("posts", (q) => q.where("published", true)).get();
// → only users who have at least one published post, AND their published posts are eagerly loaded
```

### Lazy-load prevention

To catch accidental N+1 queries during development, enable lazy-load prevention globally:

```ts
import { Model } from "@bunnykit/orm";
Model.preventLazyLoading = true;
```

After that, any access to an un-loaded relation throws — pushing you to add a `.with()` call up the chain. Disable in production or wrap with `if (process.env.NODE_ENV !== "production")`.

## Relation queries

Filter or check relations without dropping into raw joins:

```ts
// Users that have at least one post
await User.has("posts").get();

// Users with at least 3 published posts
await User.whereHas("posts", (q) => q.where("published", true), ">=", 3).get();

// Users with NO posts
await User.doesntHave("posts").get();

// Or: filter by a single related column
await User.whereRelation("posts", "title", "like", "Hello%").get();

// Polymorphic: filter a morphTo
const author = await User.find(1);
await Comment.whereMorphedTo("commentable", author).get();
```

See [Relationships](./relationships.md#querying-relations) for the full reference.

## Pagination

### Offset (with total)

```ts
const page = await User.orderBy("name").paginate(15, 1);
page.data;          // Collection<User>
page.total;         // number — total matching row count
page.perPage;       // 15
page.currentPage;   // 1
page.lastPage;      // ceil(total / perPage)
page.json();        // plain object suitable for API responses
```

### Simple (no total query)

```ts
const simple = await User.orderBy("name").simplePaginate(15, 1);
simple.data;             // Collection<User>
simple.has_more_pages;   // boolean
simple.next_page;        // number | null
simple.prev_page;        // number | null
```

Use this on big tables where computing the total is expensive and "Next / Prev" navigation is enough.

### Cursor (keyset)

```ts
const first = await User.orderBy("id").cursorPaginate(15);
first.data;          // Collection<User>
first.next_cursor;   // opaque string | null

if (first.next_cursor) {
  const next = await User.orderBy("id").cursorPaginate(15, first.next_cursor);
  next.prev_cursor;
}
```

Cursor pagination is stable under inserts and deletes — perfect for infinite-scroll feeds and append-only event logs.

## Streaming large datasets

Use streaming when you need to process every row but can't hold the result set in memory.

```ts
// Chunked: callback receives a Collection of up to N rows
await User.chunk(100, (users) => {
  for (const user of users) { /* ... */ }
});

// Per-row callback
await User.each(100, (user) => console.log(user.name));

// Keyset-paginated chunks — safe under concurrent writes
await User.chunkById(100, (users) => users.pluck("email"));
await User.eachById(100, (user) => console.log(user.email));

// Descending keyset (newest first)
await User.chunkByIdDesc(100, (users) => users.pluck("id"));

// Async iterators
for await (const user of User.cursor()) { /* one at a time */ }
for await (const user of User.lazy(500)) { /* chunked iteration */ }
for await (const user of User.lazyById(500)) { /* keyset chunked */ }
```

**Avoid `offset` for large tables** — once you're past a few thousand rows, offset pagination becomes O(offset) on most engines. Reach for `chunkById` / `lazyById` instead.

## Conditional building

`when()` and `unless()` let you compose filters from optional inputs without an `if`-ladder:

```ts
const filters = { name: "Alice", role: undefined };
const showInactive = false;

const users = await User
  .when(filters.name,  (q) => q.where("name", filters.name))
  .when(filters.role,  (q) => q.where("role", filters.role))
  .unless(showInactive, (q) => q.where("active", true))
  .get();
```

The first argument can be any truthy / falsy value. Use this everywhere you'd otherwise write `if (filters.x) q.where(...)`.

## Select, raw, and subqueries

```ts
User.select("name", "email");
User.addSelect("role");                            // append without replacing
User.select("name").selectRaw("price * 2 as doubled");
User.fromSub(User.where("price", ">", 100), "expensive");
User.select("*").distinct();
User.orderByRaw("LOWER(name) ASC");
User.selectRaw("DATE(created_at) as day, COUNT(*) as total").groupByRaw("DATE(created_at)");
```

`selectRaw` and `orderByRaw` accept the same `?` placeholders as the rest of the builder — never interpolate user input.

## Locking

Available on MySQL and PostgreSQL:

```ts
await User.where("id", 1).lockForUpdate().first();         // FOR UPDATE
await User.where("id", 1).sharedLock().first();            // FOR SHARE / LOCK IN SHARE MODE
await Job.where("status", "pending").skipLocked().limit(10).get();
await Job.where("status", "pending").noWait().first();
```

Combine with a [transaction](./transactions.md) — locks released on commit / rollback.

`skipLocked` is the idiomatic way to pull jobs off a queue without contention:

```ts
await connection.transaction(async () => {
  const jobs = await Job
    .where("status", "pending")
    .orderBy("created_at")
    .limit(10)
    .lockForUpdate()
    .skipLocked()
    .get();
  for (const job of jobs) { /* ... */ }
});
```

## Bulk write operations

```ts
// Raw insert — no model events fire
await User.query().insert({ name: "Alice", email: "alice@example.com" });
await User.query().insertOrIgnore([{ email: "a@b.com" }, { email: "c@d.com" }]);
const id = await User.query().insertGetId({ name: "Bob" });

// Upsert: insert or update on conflict
await User.query().upsert(
  [{ email: "alice@example.com", name: "Alice" }],
  ["email"],          // unique key columns
  ["name"],           // columns to overwrite on conflict
);

// Update matched rows
await User.where("active", false).update({ deleted: true });

// Update with JOIN (Postgres / SQL Server)
await Post.query().updateFrom("users", "users.id", "=", "posts.user_id");

// Delete
await User.where("active", false).delete();

// Increment / Decrement
await user.increment("login_count");
await user.increment("login_count", 5, { last_login_at: new Date() });
await user.decrement("stock", 10);
await User.where("active", false).decrement("score", 2);
```

`insert`, `update`, and `delete` on the builder bypass [observers](./observers.md) and `timestamps`. If you want lifecycle hooks, work through model instances (`new User()`, `user.save()`, `user.delete()`) instead.

## Debugging

```ts
User.where("name", "Alice").toSql();      // compile only, returns string
User.where("name", "Alice").dump();       // log SQL, keep chain
User.where("name", "Alice").dd();         // log SQL and throw
await User.where("name", "Alice").explain(); // run EXPLAIN
```

`dd()` ("dump and die") is the fastest way to verify a query before adding `.get()` at the end.

## Common pitfalls

- **N+1 queries.** If you find yourself looping over a collection and accessing relations, add a `.with()` higher up. Turn on `Model.preventLazyLoading = true` in development to catch these automatically.
- **`offset` on huge tables.** Past a few thousand rows, `LIMIT/OFFSET` pagination scans linearly. Use `chunkById`, `lazyById`, or `cursorPaginate`.
- **`update` / `delete` on the builder skip events.** If observers, timestamps, or soft deletes matter, work through model instances.
- **`distinct()` and `with()` together.** Eager-load joins can introduce duplicate parent rows. Add `distinct()` or use the relation aggregate variants (`withCount`, `withExists`) when you only need scalars.
- **Locking outside a transaction is a no-op.** `lockForUpdate` releases at commit, so without a `connection.transaction(...)` wrapper there's nothing to release against.

## Method reference

Most builder methods can be called either from `Model.query()` or directly on the model class:

```ts
await Room.whereExists("SELECT 1 FROM bookings WHERE bookings.room_id = rooms.id").get();
await Room.whereBetween("capacity", [2, 8]).orderByDesc("capacity").get();
```

| Method | Description |
|---|---|
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
| `whereDate / whereDay / whereMonth / whereYear / whereTime` | Date-part filters |
| `whereJsonContains(col, val)` | JSON membership (cross-DB) |
| `whereJsonLength(col, op, val)` | JSON array length |
| `whereLike / whereNotLike / whereRegexp / whereFullText` | Pattern / FTS filters |
| `whereAll(cols, op, val)` | Multi-column `AND` |
| `whereAny(cols, op, val)` | Multi-column `OR` |
| `whereKey(id \| ids)` | Filter by primary key |
| `whereKeyNot(id \| ids)` | Exclude by primary key |
| `orderBy(col, dir)` | Sort |
| `orderByDesc(col)` | Sort descending shorthand |
| `orderByRaw(sql)` | Raw `ORDER BY` |
| `latest(col?)` / `oldest(col?)` | Order by timestamp |
| `inRandomOrder()` | RANDOM ordering |
| `reorder(col?, dir?)` | Clear / replace orders |
| `groupBy(...cols)` / `groupByRaw(sql)` | Group |
| `having / havingRaw / orHaving / orHavingRaw` | Group filters |
| `join / leftJoin / rightJoin / crossJoin` | Joins |
| `union(query)` / `unionAll(query)` | Set ops |
| `select / addSelect / selectRaw / distinct / fromSub` | Column selection |
| `limit / offset / take / skip / forPage` | Row limits |
| `lockForUpdate / sharedLock / skipLocked / noWait` | Locks |
| `get / getArray / first / find / findMany / findOrFail` | Read terminators |
| `firstWhere / firstOrFail / sole / value / pluck` | Read terminators |
| `count / sum / avg / min / max / exists / doesntExist` | Aggregates |
| `paginate / simplePaginate / cursorPaginate` | Pagination |
| `chunk / each / chunkById / chunkByIdDesc / eachById` | Streaming |
| `cursor / lazy / lazyById` | Async iterators |
| `insert / insertGetId / insertOrIgnore / upsert` | Inserts |
| `update / updateFrom / increment / decrement` | Updates |
| `delete / restore` | Deletes |
| `with(...rels)` | Eager load |
| `has / orHas / whereHas / orWhereHas / doesntHave / whereDoesntHave` | Relation existence |
| `whereRelation / orWhereRelation` | Filter by related column |
| `whereMorphedTo / orWhereMorphedTo / whereNotMorphedTo` | Polymorphic filters |
| `withWhereHas` | Filter + eager load |
| `withCount / withSum / withMin / withMax / withAvg` | Relation aggregates |
| `withExists` | Boolean relation flag |
| `scope(name, ...args)` | Apply local scope |
| `withoutGlobalScope(name) / withoutGlobalScopes()` | Drop global scopes |
| `withTrashed() / onlyTrashed()` | Soft delete visibility |
| `when(cond, fn, elseFn?) / unless(...)` | Conditional |
| `tap(fn)` | Mutate and return |
| `clone()` | Copy builder state |
| `toSql() / dump() / dd() / explain()` | Debugging |
