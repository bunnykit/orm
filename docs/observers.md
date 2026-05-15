# Observers

Observers let you hook into a model's lifecycle without scattering side-effects through your CRUD code. Use them for things like:

- Sending a "welcome" email on user creation.
- Writing an audit log entry when an order changes state.
- Maintaining derived columns (`updated_at` on a parent, `last_post_at` on an author).
- Invalidating an external cache when a record is deleted.

Observers fire automatically whenever a model is saved, updated, or deleted through a model instance (`user.save()`, `user.delete()`, `User.create(...)`). They do **not** fire on raw builder operations (`User.where(...).update(...)`).

## Registering

`ObserverRegistry.register(ModelClass, observer)` attaches one or more handlers to a model. Call it once at app startup — typically right after `configureBunny()`:

```ts
import { ObserverRegistry } from "@bunnykit/orm";
import User from "./models/User";
import { sendWelcomeEmail, recordSignup } from "./services/users";

ObserverRegistry.register(User, {
  async created(user) {
    await sendWelcomeEmail(user.email);
    await recordSignup(user.id);
  },
  async deleting(user) {
    if (user.is_admin) {
      throw new Error("Cannot delete admin users");
    }
  },
});
```

Multiple observers can be registered for the same model — they run in registration order.

```ts
ObserverRegistry.register(User, auditObserver);
ObserverRegistry.register(User, cacheObserver);
ObserverRegistry.register(User, notificationObserver);
```

Remove all observers for a model with `ObserverRegistry.unregister(User)` — useful in tests.

## Lifecycle events

Every hook is optional. Each receives the model instance.

| Event | Fires |
|---|---|
| `creating` | Before a new row is inserted. Throw to abort the insert. |
| `created` | After a new row is inserted and the primary key is populated. |
| `updating` | Before an existing row is updated. Throw to abort. |
| `updated` | After an existing row is updated. |
| `saving` | Before both create and update — runs in addition to `creating` / `updating`. |
| `saved` | After both create and update. |
| `deleting` | Before a row is deleted (or soft-deleted). Throw to abort. |
| `deleted` | After a row is deleted (or soft-deleted). |
| `restoring` | Before a soft-deleted row is restored. |
| `restored` | After a soft-deleted row is restored. |

Order of firing on `save()` of a new instance: `saving` → `creating` → INSERT → `created` → `saved`.

On `save()` of an existing instance: `saving` → `updating` → UPDATE → `updated` → `saved`.

On `delete()`: `deleting` → DELETE → `deleted`. For soft deletes, the row is updated rather than removed; `deleting` and `deleted` still fire.

On `restore()` (soft deletes only): `restoring` → UPDATE → `restored`.

## Patterns

### Block a save with `throw`

`creating`, `updating`, `saving`, and `deleting` can prevent the operation by throwing. The error propagates out of the `save()` / `delete()` call and the database is untouched:

```ts
ObserverRegistry.register(Order, {
  updating(order) {
    if (order.getOriginal("status") === "paid" && order.status === "draft") {
      throw new Error("Cannot reset a paid order to draft");
    }
  },
});
```

### Mutate the model before save

Set or normalize attributes inside `saving` / `creating` / `updating`. The change is included in the SQL that runs:

```ts
ObserverRegistry.register(Post, {
  saving(post) {
    if (!post.slug) {
      post.slug = post.title.toLowerCase().replace(/\s+/g, "-");
    }
  },
});
```

### Inspect what changed

`getDirty()` returns the in-memory pending changes; `wasChanged(key?)` reports what changed after the save completes:

```ts
ObserverRegistry.register(User, {
  updating(user) {
    if ("email" in user.getDirty()) {
      // queue a verification email for the new address
    }
  },
  updated(user) {
    if (user.wasChanged("plan")) {
      // emit a billing webhook
    }
  },
});
```

## Bypassing observers

Sometimes you need to write without firing events — bulk imports, data migrations, periodic cleanup.

```ts
// One-shot: instance method
await user.saveQuietly();
await user.deleteQuietly();

// Per call: explicit option
await model.save({ events: false });

// Bulk methods
await User.createMany(records, { events: false });
await User.saveMany(models, { events: false });

// Builder writes already skip observers
await User.where("inactive", true).update({ archived: true }); // no events fire
```

If a write is supposed to trigger side-effects, work through model instances. If it isn't (analytics rollups, scheduled cleanups), the builder path is faster and cheaper.

## Testing observers

In test setup, register the observers you want to exercise and unregister them in teardown:

```ts
import { beforeEach, afterEach } from "bun:test";
import { ObserverRegistry } from "@bunnykit/orm";
import User from "../src/models/User";
import { UserObserver } from "../src/observers/UserObserver";

beforeEach(() => {
  ObserverRegistry.register(User, new UserObserver());
});

afterEach(() => {
  ObserverRegistry.unregister(User);
});
```

Avoid sharing observer state between tests — each registration is global until removed.

## Common pitfalls

- **Builder writes skip observers.** `Model.where(...).update(...)`, `delete()`, `insert()`, and `upsert()` all bypass the registry. If side-effects matter, fetch the instance and call `.save()` / `.delete()`.
- **`saving` runs before `creating`/`updating`.** If both hooks set the same attribute, `creating`/`updating` wins because it runs later.
- **`created` runs after the insert.** The primary key is set by then, but the relation cache is still empty. If you need to immediately load a freshly created relation, do it in `created` (after) — not `creating` (before).
- **Cyclic saves.** Calling `.save()` on another model inside an observer can cascade into more observer fires. Guard with a flag or use [`saveQuietly`](./models.md#quiet-operations-skip-observers) inside the observer.
- **Async work inside observers blocks the calling code.** If you need fire-and-forget behavior, push the work to a queue rather than awaiting it inline.

## Where to next

- [Models — quiet operations](./models.md#quiet-operations-skip-observers) — `saveQuietly` / `deleteQuietly` and `{ events: false }` flags.
- [Models — `touches`](./models.md#touches---bump-parent-timestamps) — declarative parent-timestamp updates, simpler than an observer.
- [Transactions](./transactions.md) — wrap multi-model writes so observer-driven side effects don't fire when the parent change rolls back.
