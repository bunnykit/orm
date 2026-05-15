# Collections

`Collection<T>` is what every multi-row query returns. It extends the native `Array`, so any `Array` method (`map`, `filter`, `reduce`, `slice`, `forEach`, ...) works on it. On top of that, it adds Laravel-style helpers for grouping, pluck-by-key, aggregates, and post-retrieval relation loading.

```ts
import { collect, Collection } from "@bunnykit/orm";
```

## Where Collections come from

```ts
const users = await User.where("active", true).get();    // Collection<User>

users instanceof Collection; // true
users instanceof Array;      // true — extends Array
users.length;                // standard array length
users[0];                    // index access
JSON.stringify(users);       // serializes as a plain array
```

If you just want a plain array, terminate with `getArray()`:

```ts
const arr = await User.where("active", true).getArray(); // User[]
```

Wrap any iterable manually with `collect()`:

```ts
const numbers = collect([1, 2, 3, 4]);
numbers.sum();    // 10
numbers.avg();    // 2.5
```

## Conversion

| Method | Returns |
|---|---|
| `all()` | Plain `T[]` snapshot |
| `toArray()` | Alias for `all()` |
| `toJSON()` | Array of plain objects — calls `toJSON()` on each item (good for API responses) |
| `json()` | Alias for `toJSON()` |

```ts
const payload = users.toJSON();
return Response.json(payload);
```

## State

```ts
users.isEmpty();      // boolean
users.isNotEmpty();   // boolean
users.count();        // same as users.length
```

## Finding

```ts
users.first();                                        // first item or null
users.first((u) => u.active);                         // first matching predicate
users.last();                                         // last item or null
users.firstWhere("email", "alice@example.com");       // shortcut equality lookup
users.get(0);                                         // by index, null if missing
users.get(99, defaultUser);                           // with default

users.contains("role", "admin");                      // key/value check
users.contains((u) => u.score > 90);                  // predicate check
```

`first` and `firstWhere` are the cleanest way to look up one item from a fetched collection without re-running a query.

## Transforming

### `pluck(key)` — extract one column

```ts
users.pluck("email");          // Collection<string>
users.pluck("address.city");   // dot-notation walks into nested values
```

### `keyBy(key)` — index by a column

```ts
const byEmail = users.keyBy("email");
byEmail["alice@example.com"];  // User | undefined

// By computed key
const byInitial = users.keyBy((u) => u.name[0].toLowerCase());
```

### `groupBy(key)` — bucket items

```ts
const byRole = users.groupBy("role");
byRole["admin"];               // Collection<User>
byRole["member"]?.count();     // number

// By callback
const byDecade = users.groupBy((u) => Math.floor(u.age / 10) * 10);
```

### `map / filter / reduce` (inherited from `Array`)

```ts
const names = users.map((u) => u.name);
const adults = users.filter((u) => u.age >= 18);
const total = users.reduce((acc, u) => acc + u.score, 0);
```

`map` and `filter` on a `Collection` return a plain `Array` because they come from the `Array` prototype. Re-wrap with `collect()` if you need helpers back:

```ts
const adults = collect(users.filter((u) => u.age >= 18));
adults.groupBy("city");
```

## Filtering helpers

```ts
users.where("role", "admin");                  // equality
users.whereIn("role", ["admin", "mod"]);       // IN set
users.reject((u) => u.active === false);       // inverse of filter
```

These mirror the [query builder](./query-builder.md) names so the same vocabulary works whether you filter at the SQL layer or after retrieval.

## Sorting

```ts
users.sortBy("name");                          // ascending
users.sortByDesc("created_at");                // descending
users.sortBy((u) => u.score);                  // by callback
```

`sortBy` returns a new `Collection` — the original is unchanged.

## Slicing

```ts
users.take(10);                                // first N
users.skip(5);                                 // drop first N
users.take(-3);                                // last 3
```

## Aggregates

```ts
users.count();                                 // number of items
users.sum("score");                            // sum of a column
users.avg("score");
users.min("score");
users.max("score");

// By callback
users.sum((u) => u.score * u.multiplier);
```

Aggregates iterate the items in memory — they don't hit the database. For database-side aggregates use [`withCount` / `withSum`](./query-builder.md#relation-aggregates).

## Iteration

```ts
for (const user of users) { /* ... */ }              // native for-of

users.each((user, index) => console.log(index, user.name));   // chainable
users.forEach(...);                                  // inherited from Array
```

`each` returns the collection so it composes with other chained calls.

## Post-retrieval relation loading

When you already have a collection and discover you need a relation, load it without re-querying the parents:

```ts
// Load only the missing relation on whatever subset already has it
await users.loadMissing("posts");
await users.loadMissing("posts.comments", "manager");

// Load a polymorphic morph target across mixed types
await comments.loadMorph("commentable", {
  Post: ["author"],
  Photo: ["album"],
});

// Load relation aggregates after the fact
await users.loadCount("posts");
await users.loadSum("orders", "total");
await users.loadAvg("orders", "rating");
await users.loadMin("orders", "created_at");
await users.loadMax("orders", "score");

// Constrained variants
await users.loadCount("posts", (q) => q.where("published", true));
await users.loadSum("orders", "total", (q) => q.where("status", "paid"));
await users.loadSum("orders", "total", "paid_total", (q) => q.where("status", "paid"));
```

These work the same as their query-builder counterparts (`with`, `withCount`, `withSum`, ...) but skip the parent fetch. They're useful when:

- You loaded parents from cache and now need fresh relations.
- You're building a response and only need certain aggregates conditionally.
- You're iterating over a streaming `chunk` and want to attach relations per batch.

See [Relationships](./relationships.md#eager-loading) for the canonical eager-loading flow.

## Common pitfalls

- **`Array` method returns lose helpers.** `users.map(...)` returns a plain `Array`, not a `Collection`. Re-wrap with `collect()` if you need Collection helpers.
- **Aggregates iterate in memory.** Collection `sum`/`avg`/etc. don't query the database. For huge result sets, push the aggregate down with `Model.sum("...")` instead.
- **`pluck` returns a `Collection`, not a plain array.** Use `.all()` if a caller needs a plain `T[]`.
- **`sortBy` is not in-place.** It returns a new collection; the original order is preserved.
