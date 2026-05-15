# Seeders and Factories

Seeders are scripts that populate the database with development, demo, or test data. Factories generate realistic-looking model attributes that seeders (and tests) can use to create many similar records quickly.

```ts
import { Seeder, factory, SeederRunner } from "@bunnykit/orm";
```

## Writing a seeder

Extend the `Seeder` class and implement `run()`:

```ts
// database/seeders/UserSeeder.ts
import { Seeder } from "@bunnykit/orm";
import User from "../../src/models/User";

export default class UserSeeder extends Seeder {
  async run() {
    await User.create({ name: "Ada Lovelace",  email: "ada@example.test" });
    await User.create({ name: "Linus Torvalds", email: "linus@example.test" });
  }
}
```

A seeder can call models, run raw SQL via `this.connection`, or invoke other seeders:

```ts
import { Seeder } from "@bunnykit/orm";
import UserSeeder from "./UserSeeder";
import PostSeeder from "./PostSeeder";

export default class DemoSeeder extends Seeder {
  async run() {
    await this.call([UserSeeder, PostSeeder]);  // run other seeders in order
    await this.connection.run("ANALYZE");
  }
}
```

`this.connection` is the active connection — including any tenant scoping. Inside `DB.tenant("acme", ...)` it is the tenant-qualified connection.

## Configuring the seeder path

Set `seedersPath` in `bunny.config.ts`:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  seedersPath: "./database/seeders",
};
```

Multiple roots are allowed:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  seedersPath: ["./database/seeders", "./modules/demo/seeders"],
};
```

The CLI walks every file in these directories that ends in `.ts` or `.js` and looks for a default export extending `Seeder`.

## Running seeders

### CLI

```bash
# All seeders in seedersPath, in filename order
bunx bunny db:seed

# A single seeder by class name (found under seedersPath)
bunx bunny db:seed UserSeeder

# A single seeder by file path
bunx bunny db:seed ./database/seeders/UserSeeder.ts

# Multi-tenant
bunx bunny db:seed --tenant acme
bunx bunny db:seed --tenant acme UserSeeder
bunx bunny db:seed --tenants                 # iterate every tenant from listTenants()
```

When the command runs in a tenant context, `SeederRunner` automatically uses the tenant's connection. Seeder runs are wrapped in a transaction — if any seeder throws, the entire run rolls back.

### Programmatic — `SeederRunner`

```ts
import { SeederRunner } from "@bunnykit/orm";

const runner = new SeederRunner();

// Run every seeder in one or more paths
await runner.runPaths("./database/seeders");
await runner.runPaths(["./database/seeders", "./modules/demo/seeders"]);

// Run one seeder by file path
await runner.runFile("./database/seeders/UserSeeder.ts");

// Run one seeder by class name (searches given paths)
await runner.runTarget("UserSeeder", "./database/seeders");

// Or pass class instances / classes directly
await runner.run(UserSeeder, new PostSeeder());
```

### Programmatic — `configureBunny()` facade

If you already loaded `bunny.config.ts`, the facade is the shortest path:

```ts
import { configureBunny } from "@bunnykit/orm";
import config from "../bunny.config";

const bunny = configureBunny(config);
await bunny.seed();    // uses config.seedersPath
```

See [Library Usage](./library-usage.md).

## Factories

Factories produce attribute objects, unsaved model instances, or persisted records — driven by a `sequence` counter so each generated record is unique.

```ts
import { factory } from "@bunnykit/orm";
import User from "../models/User";

const users = factory(User, (sequence) => ({
  name: `User ${sequence}`,
  email: `user${sequence}@example.test`,
  role: "member",
}));

const raw = users.raw();                          // attribute object
const model = users.make();                       // unsaved User
const created = await users.create();             // saved User
```

### Counts and state overrides

```ts
// Five users
const many = await users.count(5).create();

// Override the role for this batch
const admins = await users
  .count(3)
  .state({ role: "admin" })
  .create();

// Stateful by sequence
const mixed = await users
  .count(10)
  .state((attrs, seq) => ({
    role: seq % 2 === 0 ? "admin" : "member",
  }))
  .create();
```

`raw()`, `make()`, and `create()` each respect the count and state, so you can also use a factory to seed an unsaved fixture for a test:

```ts
const fixtures = factory(User, (s) => ({ name: `Test ${s}` }))
  .count(3)
  .make();   // User[] — unsaved
```

## Test data idempotency

Seeders run more than once during development. Make them safe to re-run:

```ts
export default class UserSeeder extends Seeder {
  async run() {
    // Idempotent: only create if missing
    await User.firstOrCreate(
      { email: "ada@example.test" },
      { name: "Ada Lovelace" },
    );

    await User.updateOrInsert(
      { email: "linus@example.test" },
      { name: "Linus Torvalds", active: true },
    );
  }
}
```

For destructive seeders (wipe and reload), call `Model.truncate()` first or rely on `bunny.fresh()` (drop + re-migrate + re-seed).

## Common pitfalls

- **Order matters.** Bunny runs seeders alphabetically by filename. If `PostSeeder` needs users, prefix it (`02_PostSeeder.ts`) or call seeders from a single `DatabaseSeeder` that lists them in the right order.
- **Atomicity surprises.** If one seeder throws, the transaction rolls back the entire run. Side-effects sent to external systems (emails, queue jobs) outside the database still went out — make seeders pure data work.
- **Tenant scope is implicit.** Inside `DB.tenant()` or `bunx bunny db:seed --tenant`, `this.connection` is the tenant connection. If you also want to seed landlord-scoped data, do it outside the tenant block.
- **Factories don't apply observers by default for `raw()` and `make()`.** Only `create()` persists the record (and therefore fires observers).

## Where to next

- [Library Usage](./library-usage.md) — the `configureBunny()` facade including `bunny.seed()`.
- [Migrations](./migrations.md) — `bunny.fresh()` to drop, re-migrate, and re-seed in one command.
- [Testing](./testing.md) — using factories inside `bun test`.
