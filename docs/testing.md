# Testing

Bunny ships with no built-in test harness — it's just a database library — but it integrates cleanly with Bun's built-in test runner (`bun test`). This page collects the patterns you'll want when writing tests against your models.

## Quick start with `bun:test`

```ts
// tests/user.test.ts
import { describe, expect, test, beforeAll } from "bun:test";
import { Connection, Model, Schema } from "@bunnykit/orm";
import User from "../src/models/User";

describe("User model", () => {
  beforeAll(async () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);

    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").unique();
      table.timestamps();
    });
  });

  test("creates a user", async () => {
    const user = await User.create({ name: "Alice", email: "alice@example.com" });
    expect(user.id).toBeGreaterThan(0);
    expect(user.email).toBe("alice@example.com");
  });
});
```

Run with:

```bash
bun test
bun test tests/user.test.ts
bun test --watch
```

## In-memory SQLite

For unit tests, `sqlite://:memory:` is the right default — each connection has its own private database that disappears on close. Wrap setup in a helper:

```ts
// tests/helpers.ts
import { Connection, Model, Schema } from "@bunnykit/orm";

export function setupTestDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return connection;
}

export async function teardownTestDb(connection: Connection) {
  await connection.driver.close();
}
```

Then in each suite:

```ts
import { beforeAll, afterAll } from "bun:test";
import { setupTestDb, teardownTestDb } from "./helpers";

let connection: ReturnType<typeof setupTestDb>;

beforeAll(async () => {
  connection = setupTestDb();
  // run any migrations or Schema.create calls
});

afterAll(async () => {
  await teardownTestDb(connection);
});
```

This is the same pattern Bunny's own test suite uses — see `tests/helpers.ts` in the repository.

## Running real migrations in tests

For integration-style coverage, run your actual migrations rather than re-declaring schemas in test setup:

```ts
import { Migrator } from "@bunnykit/orm";

beforeAll(async () => {
  const connection = setupTestDb();
  await new Migrator(connection, "./database/migrations").run();
});
```

Each test file then starts with the production schema. Pair with [`bunny.fresh()`](./library-usage.md) or `migrator.fresh()` between suites for hard isolation.

## Seeding test data

Use [factories](./seeders.md#factories) to produce realistic fixtures inline without writing seeder files:

```ts
import { factory } from "@bunnykit/orm";
import User from "../src/models/User";

const userFactory = factory(User, (seq) => ({
  name: `User ${seq}`,
  email: `user${seq}@example.test`,
}));

test("paginates users", async () => {
  await userFactory.count(50).create();
  const page = await User.orderBy("id").paginate(15, 1);
  expect(page.total).toBe(50);
  expect(page.data.length).toBe(15);
});
```

For shared fixtures across many tests, put a seeder under `tests/fixtures/` and invoke it from `beforeAll`:

```ts
import { SeederRunner } from "@bunnykit/orm";
import UserFixtureSeeder from "./fixtures/UserFixtureSeeder";

beforeAll(async () => {
  setupTestDb();
  await new SeederRunner().run(UserFixtureSeeder);
});
```

## Transactional isolation

The fastest way to isolate test cases is to wrap each test in a transaction and roll back at the end. Bunny's nested-transaction support makes this safe even when the system under test opens its own transactions:

```ts
import { afterEach } from "bun:test";

let outerCommit: (() => Promise<void>) | null = null;

beforeEach(async () => {
  await connection.beginTransaction();
});

afterEach(async () => {
  await connection.rollback();
});
```

Inside a test, any nested `connection.transaction(...)` uses a savepoint that's rolled back when the outer transaction is. The next test starts with the original schema and seed data intact.

## Testing observers

Register observers in `beforeEach` and unregister in `afterEach` to avoid cross-test bleed:

```ts
import { beforeEach, afterEach } from "bun:test";
import { ObserverRegistry } from "@bunnykit/orm";
import User from "../src/models/User";
import UserObserver from "../src/observers/UserObserver";

beforeEach(() => {
  ObserverRegistry.register(User, new UserObserver());
});

afterEach(() => {
  ObserverRegistry.unregister(User);
});
```

See [Observers — Testing](./observers.md#testing-observers).

## Integration tests against PostgreSQL / MySQL

For full-fidelity tests on Postgres or MySQL, point `setupTestDb()` at a real database. The repo's own integration suite uses an environment variable:

```ts
const url = process.env.POSTGRES_TEST_URL;
const runIfPostgres = url ? test : test.skip;

runIfPostgres("integration against Postgres", async () => {
  const connection = new Connection({ url });
  // …
});
```

Run with:

```bash
POSTGRES_TEST_URL=postgres://localhost/test_db bun test
```

Skipping by default keeps `bun test` fast on developer machines and CI agents that don't have Postgres available.

## Common pitfalls

- **Leaking the SQLite file.** Use `sqlite://:memory:` for tests. A real file path persists between runs and produces stateful, hard-to-debug failures.
- **Forgetting to close connections.** A test that doesn't close its connection makes `bun test` hang at the end. Always close in `afterAll` (or rely on `setupTestDb` / `teardownTestDb`).
- **Cross-test observer state.** Observers register globally. Re-registering the same observer in `beforeEach` without unregistering in `afterEach` accumulates handlers and fires them multiple times.
- **Tenant context bleed.** If a test opens `DB.tenant(...)` and the callback throws before completing, the next test inherits no tenant — but a careless `TenantContext.run` outside a `try` block can mask failures. Wrap tenant flows in `try / finally`.
- **Tests sharing a single connection across files.** `bun test` parallelizes by default. If tests in two files share a global connection, expect race conditions. Either use one connection per file, or run with `bun test --concurrent false`.

## Where to next

- [Library Usage](./library-usage.md) — running migrations and seeders programmatically for test setup.
- [Seeders](./seeders.md) — factories and reusable fixture seeders.
- [Transactions](./transactions.md) — the nested savepoint behavior that makes transactional isolation possible.
