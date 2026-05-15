# Schema Builder

The schema builder defines tables, columns, indexes, and foreign keys in TypeScript instead of raw SQL. The same code emits the right dialect for SQLite, MySQL, and PostgreSQL — you do not have to maintain three versions of every migration.

`Schema` is a static class. You typically call it from inside [Migration](./migrations.md) files, but it works anywhere a `Connection` is set.

```ts
import { Schema } from "@bunnykit/orm";
```

## Creating tables

`Schema.create(name, callback)` runs `CREATE TABLE` and any associated index / foreign key statements in order:

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
  table.softDeletes();
});
```

If the table might already exist, use `createIfNotExists`:

```ts
await Schema.createIfNotExists("settings", (table) => {
  table.increments("id");
  table.string("key").unique();
  table.text("value");
});
```

## Column types

Every method on the blueprint adds a column. The first argument is always the column name.

### Integers

| Method | SQL type |
|---|---|
| `increments(name = "id")` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `bigIncrements(name = "id")` | `BIGINT PRIMARY KEY AUTOINCREMENT` |
| `tinyInteger(name)` | `TINYINT` |
| `smallInteger(name)` | `SMALLINT` |
| `integer(name)` | `INTEGER` |
| `bigInteger(name)` | `BIGINT` |

```ts
table.integer("views").unsigned().default(0);
table.bigInteger("file_size").nullable();
```

`unsigned()` is honored on MySQL; PostgreSQL and SQLite ignore it (no native unsigned type).

### Floating point and decimals

| Method | Notes |
|---|---|
| `float(name, p = 8, s = 2)` | Single-precision float |
| `double(name, p = 8, s = 2)` | Double-precision float |
| `decimal(name, p = 8, s = 2)` | Fixed-precision number — use for money |

```ts
table.decimal("price", 10, 2);   // up to 99,999,999.99
table.decimal("tax_rate", 5, 4); // 0.0000 – 9.9999
```

Always store currency as `decimal`, not `float`/`double`. Floats lose precision on rounding.

### Strings and text

| Method | Notes |
|---|---|
| `string(name, length = 255)` | `VARCHAR(length)` |
| `text(name)` | Unbounded `TEXT` |

```ts
table.string("email", 191).unique(); // 191 = MySQL utf8mb4 index cap
table.text("body").nullable();
```

### Booleans and dates

| Method | Notes |
|---|---|
| `boolean(name)` | `BOOLEAN` (TINYINT(1) on MySQL) |
| `date(name)` | `DATE` |
| `time(name)` | `TIME` |
| `dateTime(name)` | `DATETIME` |
| `timestamp(name)` | `TIMESTAMP` (timezone-aware on Postgres) |

```ts
table.boolean("is_published").default(false);
table.timestamp("published_at").nullable();
```

### JSON

| Method | Notes |
|---|---|
| `json(name)` | Native `JSON` (MySQL / PostgreSQL); `TEXT` on SQLite |
| `jsonb(name)` | `JSONB` (Postgres only); falls back to `JSON` elsewhere |

```ts
table.json("preferences").default("{}");
table.jsonb("search_index").nullable();
```

Use `jsonb` on Postgres for indexable / queryable JSON. See [`whereJsonContains`](./query-builder.md#json-clauses).

### Identifiers

| Method | Notes |
|---|---|
| `uuid(name)` | `UUID` (Postgres native, `CHAR(36)` elsewhere) |
| `binary(name)` | `BLOB` / `BYTEA` |
| `enum(name, ["a","b"])` | Native `ENUM` on MySQL/Postgres; `TEXT` + check elsewhere |

```ts
table.uuid("public_id").unique();
table.enum("status", ["draft", "published", "archived"]).default("draft");
```

### Foreign-key shortcuts

| Method | Equivalent |
|---|---|
| `foreignId(name)` | `bigInteger(name).unsigned()` |
| `foreignUuid(name)` | `uuid(name)` |

```ts
table.foreignId("user_id").constrained();         // bigInteger(user_id) + FK users.id
table.foreignUuid("tenant_id").constrained();
```

## Column modifiers

Modifiers attach to the most recently added column.

```ts
table.string("email").unique();              // UNIQUE constraint
table.string("slug").index();                // INDEX
table.string("name").nullable();             // NULL allowed
table.integer("role").default(1);            // DEFAULT 1
table.string("code").comment("SKU code");    // COMMENT
table.integer("user_id").unsigned();         // UNSIGNED (MySQL)
table.string("uuid").primary();              // Composite/custom primary key column
```

| Modifier | Effect |
|---|---|
| `.nullable()` | Allow `NULL` values |
| `.default(value)` | Default literal (or `Schema.raw(...)` for expressions) |
| `.unique()` | Add a single-column UNIQUE constraint |
| `.index()` | Add a single-column index |
| `.primary()` | Mark column as part of the primary key |
| `.unsigned()` | Unsigned numeric (MySQL) |
| `.comment(text)` | Column comment (MySQL / Postgres) |

Modifiers are chainable in any order before the next column is added.

## Convenience helpers

```ts
table.timestamps();        // adds nullable created_at + updated_at TIMESTAMP columns
table.softDeletes();       // adds nullable deleted_at TIMESTAMP
```

These produce the same columns Bunny's [soft delete model trait](./models.md#soft-deletes) and [auto-timestamps](./models.md#timestamps) expect, so they're worth using on every table that needs them.

### Polymorphic columns

For polymorphic relations (one column referring to multiple tables), use a `*morphs` helper. It adds the type column, id column, and a composite index in one call.

```ts
// commentable_type + commentable_id (+ index)
table.morphs("commentable");

// nullable subject_type + subject_id (+ index)
table.nullableMorphs("subject");

// UUID-keyed variant
table.uuidMorphs("commentable");

// Nullable UUID variant
table.nullableUuidMorphs("subject");
```

Use these on tables holding [`MorphTo`](./relationships.md#polymorphic-relations) targets — `comments`, `activities`, `attachments`, etc.

## Indexes

### Single-column

```ts
table.string("slug").index();          // auto-named: <table>_slug_index
table.string("email").unique();        // auto-named: <table>_email_unique
```

### Composite

```ts
table.index(["user_id", "created_at"]);                  // auto-named
table.index(["user_id", "created_at"], "ix_posts_user"); // explicit name
table.uniqueIndex(["slug"]);                             // auto-named
table.uniqueIndex(["org_id", "key"], "settings_unique"); // explicit
```

### Dropping (inside `Schema.table`)

```ts
await Schema.table("posts", (table) => {
  table.dropIndex("posts_slug_index");
  table.dropUnique("posts_email_unique");
  table.dropForeign("posts_user_id_foreign");
});
```

| Method | Purpose |
|---|---|
| `.index()` | Single-column index, auto-named |
| `.index(cols)` / `.index(cols, name)` | Composite index |
| `.unique()` | Single-column unique constraint |
| `.uniqueIndex(cols, name?)` | Composite unique index |
| `.dropIndex(name)` | Drop a named index |
| `.dropUnique(name)` | Drop a unique constraint |
| `.dropForeign(name)` | Drop a foreign key constraint |

## Foreign keys

### Explicit form

```ts
await Schema.create("posts", (table) => {
  table.increments("id");
  table.integer("user_id").unsigned();
  table
    .foreign("user_id")
    .references("id")
    .on("users")
    .onDelete("cascade")
    .onUpdate("restrict");
  table.string("title");
});
```

### Convention-based form

`constrained()` infers the referenced table from the column name (`user_id` → `users`):

```ts
await Schema.create("posts", (table) => {
  table.increments("id");
  table.foreignId("user_id").constrained();                  // FK posts.user_id → users.id
  table.foreignId("category_id").constrained().nullable();
  table.foreignUuid("tenant_id").constrained();
  table.string("title");
  table.timestamps();
});
```

Cascade helpers chain naturally:

```ts
table.foreignId("user_id").constrained().cascadeOnDelete();
table.foreign("user_id").references("id").on("users").onDelete("set null");
```

`onDelete` accepts `"cascade"`, `"restrict"`, `"set null"`, `"no action"`, or `"set default"`. The same options apply to `onUpdate`.

## Altering tables

Use `Schema.table()` to add, modify, drop, or rename columns:

```ts
await Schema.table("users", (table) => {
  table.string("phone").nullable();
  table.timestamp("last_login").nullable();
});
```

Modify an existing column (MySQL / PostgreSQL):

```ts
await Schema.table("users", (table) => {
  table.string("name", 150).nullable().change();
});
```

Rename or drop columns:

```ts
await Schema.table("users", (table) => {
  table.renameColumn("user_name", "full_name");
  table.dropColumn("legacy_flag");
  table.dropColumn(["created_by", "updated_by"]);
});
```

Rename or drop entire tables:

```ts
await Schema.rename("users", "customers");
await Schema.drop("old_table");
await Schema.dropIfExists("old_table");
```

## Introspection

Check what already exists before acting:

```ts
if (!(await Schema.hasTable("users"))) {
  await Schema.create("users", /* ... */);
}

if (await Schema.hasColumn("users", "phone")) {
  // safe to query users.phone
}

const indexes = await Schema.getIndexes("posts");
const foreignKeys = await Schema.getForeignKeys("posts");
const exists = await Schema.hasIndex("posts", ["user_id", "created_at"]);
```

These are useful for idempotent setup scripts and for one-shot maintenance work where you don't want to write a full migration.

## Postgres schemas

PostgreSQL has named schemas separate from databases. Bunny treats them as first-class:

```ts
await Schema.createSchema("tenant_acme");
await Schema.dropSchema("tenant_acme", { cascade: true });
```

When you set `connection.schema` (or use a tenant resolver), every `Schema.create`, `Schema.drop`, and migration call automatically qualifies tables with that schema. See [Migrations — multi-tenant scopes](./migrations.md#multi-tenant-scopes).

## Driver caveats

- **SQLite** can not change column types in place. The schema builder issues `ALTER TABLE` where SQLite supports it and falls back to a `create + copy + drop + rename` recipe for unsupported operations.
- **MySQL** unique-key indexes have a 191-character limit on `utf8mb4`. Use `string("col", 191)` for unique columns.
- **PostgreSQL** is the only driver that supports `jsonb`, named `schema` qualification, and timezone-aware `timestamp`.
