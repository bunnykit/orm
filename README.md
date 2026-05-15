# Bunny

[☕ Buy me a coffee](https://paypal.me/jbeduya)

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
- 🏢 **Multi-tenant** — Database-per-tenant, schema-per-tenant, and RLS strategies with `DB.tenant()` and `TenantContext`

---

## Installation

```bash
bun add @bunnykit/orm
```

See [Installation](./docs/installation.md) for details.

---

## Quickstart

Define a model with `Model.define<T>()` to get full IntelliSense on attributes, query builder columns, and eager-load results:

```ts
import { Model } from "@bunnykit/orm";

interface UserAttributes {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

class User extends Model.define<UserAttributes>("users") {
  posts() {
    return this.hasMany(Post);
  }
}

class Post extends Model.define<{ id: number; user_id: number; title: string }>("posts") {
  author() {
    return this.belongsTo(User);
  }
}
```

Point the ORM at a database and run a query:

```ts
import { Connection, Model } from "@bunnykit/orm";

Model.setConnection(new Connection({ url: "sqlite://app.db" }));

const users = await User.where("email", "alice@example.com")
  .with("posts")
  .get();

for (const user of users) {
  console.log(user.name, user.posts.length);
}
```

Or use the `DB` facade for ad-hoc table access without a model:

```ts
import { DB } from "@bunnykit/orm";

const rows = await DB.table("audit_logs")
  .where("event", "login")
  .orderBy("created_at", "desc")
  .limit(10)
  .get();
```

See the [Quickstart guide](./docs/quickstart.md) for the full walkthrough.

---

## Documentation

### Getting Started

| Topic | Summary |
|---|---|
| [Installation](./docs/installation.md) | Add the package to your Bun project. |
| [Configuration](./docs/configuration.md) | Connection, tenancy, migrations, seeders, type generation. |
| [Quickstart](./docs/quickstart.md) | End-to-end walkthrough: install → config → migration → model → query. |

### Database

| Topic | Summary |
|---|---|
| [Schema Builder](./docs/schema-builder.md) | Tables, columns, indexes, foreign keys. |
| [Migrations](./docs/migrations.md) | Versioned schema changes, rollback, multi-tenant scopes, auto-create database / schema. |
| [Seeders](./docs/seeders.md) | Populate development and test data. |
| [Transactions](./docs/transactions.md) | `connection.transaction()` and nested savepoints. |

### Querying

| Topic | Summary |
|---|---|
| [Query Builder](./docs/query-builder.md) | Chainable `where` / `join` / `with` / aggregates, `DB` facade, raw queries. |
| [Collections](./docs/collections.md) | `map`, `filter`, `groupBy`, and other helpers returned by `get()`. |
| [Models](./docs/models.md) | Defining models, casts, accessors, soft deletes, persistence. |
| [Relationships](./docs/relationships.md) | `hasMany`, `belongsTo`, `belongsToMany`, polymorphic, eager loading. |

### TypeScript

| Topic | Summary |
|---|---|
| [TypeScript](./docs/typescript.md) | `Model.define<T>()`, typed builders, scope and accessor typing. |
| [Type Generation](./docs/type-generation.md) | Generate attribute interfaces from your database schema. |

### Advanced

| Topic | Summary |
|---|---|
| [Observers](./docs/observers.md) | Lifecycle hooks for `creating`, `updating`, `deleting`, and more. |
| [Library Usage](./docs/library-usage.md) | Programmatic API via `configureBunny()`. |
| [Testing](./docs/testing.md) | In-memory SQLite and transactional test isolation. |

The full index lives at [docs/README.md](./docs/README.md).

---

## License

MIT
