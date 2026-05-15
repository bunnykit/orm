# Bunny ORM Documentation

An Eloquent-inspired ORM for Bun with zero runtime dependencies, full TypeScript typing, and first-class multi-tenant support.

If you are new here, start with [Installation](./installation.md), then walk through the [Quickstart](./quickstart.md).

## Getting Started

| Topic | What you will learn |
|---|---|
| [Installation](./installation.md) | How to add `@bunnykit/orm` to a Bun project. |
| [Configuration](./configuration.md) | Every field on `bunny.config.ts` — connection, tenancy, migrations, seeders, type generation. |
| [Quickstart](./quickstart.md) | End-to-end walkthrough: install → config → migration → model → query. |

## Database

| Topic | What you will learn |
|---|---|
| [Schema Builder](./schema-builder.md) | Define tables, columns, indexes, and foreign keys programmatically. |
| [Migrations](./migrations.md) | Versioned schema changes, batching, rollback, multi-tenant scopes, auto-create database / schema. |
| [Seeders](./seeders.md) | Populate development and test data with reproducible scripts. |
| [Transactions](./transactions.md) | `connection.transaction()`, nested savepoints, error handling. |

## Querying

| Topic | What you will learn |
|---|---|
| [Query Builder](./query-builder.md) | Chainable `where` / `join` / `with` / aggregates / pagination, the `DB` facade, raw queries. |
| [Collections](./collections.md) | `map`, `filter`, `groupBy`, `keyBy`, and other helpers returned by `get()`. |
| [Models](./models.md) | Defining models, casts, accessors / mutators, soft deletes, persistence, JSON serialization. |
| [Relationships](./relationships.md) | `hasMany`, `belongsTo`, `belongsToMany`, polymorphic relations, eager loading, pivot helpers. |
| [Validation](./validation.md) | Typed Laravel-style validator, fluent rules, transforms, and tenant-aware `unique` / `exists`. |

## TypeScript

| Topic | What you will learn |
|---|---|
| [TypeScript](./typescript.md) | `Model.define<T>()`, typed builders, scope typing, accessor typing. |
| [Type Generation](./type-generation.md) | Generate attribute interfaces and IntelliSense for your models from the database schema. |

## Advanced

| Topic | What you will learn |
|---|---|
| [Observers](./observers.md) | Lifecycle hooks for `creating`, `created`, `updating`, `deleting`, and more. |
| [Library Usage](./library-usage.md) | Run migrations and seeders programmatically from app code using the `configureBunny()` facade. |
| [Testing](./testing.md) | In-memory SQLite, transactional test isolation, integration patterns. |
