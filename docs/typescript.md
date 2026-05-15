# TypeScript

Bunny is built TypeScript-first. With `Model.define<T>()`, every attribute, column name, relation, and scope is typed end-to-end — no code generator required, no `// @ts-ignore` needed for ordinary usage.

This document walks through the typing flow: how `Model.define<T>()` produces a fully-typed base class, how the query builder narrows on every chained call, and where you sometimes need a hand-written annotation (accessors, scopes, custom casts).

## `Model.define<T>(table)` — typed base class

Pass an attribute interface and the table name. The returned class has:

- **Property access** — `user.name`, `user.email`. Reads through accessors / casts.
- **Column autocomplete** — `User.where("email", ...)`, `User.orderBy("created_at")`.
- **Relation autocomplete** — `User.with("posts")`, `User.with("posts.comments")`.
- **Typed eager-load narrowing** — after `.with("posts")`, the relation is `Collection<Post>`, not a relation method.

```ts
import { Model } from "@bunnykit/orm";

interface UserAttributes {
  id: number;
  name: string;
  email: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

class User extends Model.define<UserAttributes>("users") {
  posts() {
    return this.hasMany(Post);
  }
  profile() {
    return this.hasOne(Profile);
  }
}

// Attribute access
const user = await User.find(1);
user!.name;       // string
user!.email;      // string | null
user!.active;     // boolean

// Column autocomplete
User.where("email", "a@b.com");     // ✓
User.orderBy("created_at", "desc"); // ✓
User.where("nonexistent", "x");     // ✗ TS error

// Relation autocomplete
User.with("posts");                 // ✓
User.with("posts.comments");        // ✓ nested
User.with("nonexistent");           // ✗ TS error

// Typed eager-load results
const users = await User.with("posts").get();
users[0].posts;                     // Collection<Post>
```

### Irregular plurals

If the class name doesn't pluralize naturally to your table name (`curricula`, `media`, `criteria`), pass the singular name as the second argument so foreign-key inference still works:

```ts
class Curriculum extends Model.define<CurriculumAttributes>("curricula") {}

// When assigning to a variable instead of subclassing:
const Curriculum = Model.define<CurriculumAttributes>("curricula", "Curriculum");
```

## Plain `extends Model<T>`

If you prefer to subclass `Model` directly — typically because you have generated `.d.ts` files in place — you can pass the attribute type as a generic. This types `$attributes` and `getAttribute()`, but does not add transparent property access or typed eager-load narrowing:

```ts
class User extends Model<UserAttributes> {
  static table = "users";
}

const user = await User.first();
user!.getAttribute("name");   // string
user!.$attributes.email;      // string | null
user!.name;                   // not typed — use getAttribute()
```

`Model.define<T>()` is strictly more featureful — pick it unless you have a specific reason not to.

## Query builder typing

`Builder<T>` is parameterized by the model class, so every result and every column reference narrows correctly:

```ts
import type { Collection } from "@bunnykit/orm";

const builder = User.where("name", "Alice");       // Builder<User>
const users: Collection<User> = await builder.get();
const usersArray: User[] = await builder.getArray();

const found: User | null = await User.find(1);
const first: User | null = await User.first();
```

When you use the `DB` facade without a model class, pass a row-shape generic to get the same column autocomplete:

```ts
import { DB } from "@bunnykit/orm";

interface UserRow {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

const rows = await DB.table<UserRow>("users")
  .where("active", true)
  .select("id", "name")
  .get();                    // rows: UserRow[]
```

See [Query Builder — Typed columns](./query-builder.md#typed-columns-intellisense).

## Eager-load narrowing

Without `.with()`, a relation is the relation method itself (`() => HasMany<Post>`). After `.with()`, the relation field narrows to its loaded type:

```ts
const raw = await User.first();
raw!.posts;                  // () => HasMany<Post> — relation method

const loaded = await User.with("posts").first();
loaded!.posts;               // Collection<Post> — narrowed

const deep = await User.with("posts.comments").first();
deep!.posts[0].comments;     // Collection<Comment>
```

Mapping:

| Relation type | Loaded type |
|---|---|
| `hasMany`, `belongsToMany`, `morphMany`, `morphToMany` | `Collection<R>` |
| `hasOne`, `belongsTo`, `morphOne`, `morphTo` | `R \| null` |

Aggregates like `withCount`, `withSum`, and `withExists` add typed scalar fields:

```ts
const users = await User.withCount("posts").withExists("profile").get();
users[0].posts_count;        // number
users[0].profile_exists;     // boolean
```

## Typed accessors

`static accessors` callbacks default to `(value, attributes, model) => any` parameters when the property is unannotated. To get full IntelliSense — including `model` as the concrete subclass — annotate with `AccessorMap<TAttrs, TModel>`:

```ts
import { Model, type AccessorMap } from "@bunnykit/orm";

interface UserAttrs {
  id: number;
  first_name: string;
  last_name: string;
}

class User extends Model.define<UserAttrs>("users") {
  declare full_name: string;

  static accessors: AccessorMap<UserAttrs, User> = {
    full_name: {
      get: (_value, attributes, model) => {
        // value:      any
        // attributes: UserAttrs       ← typed
        // model:      User            ← typed
        return `${attributes.first_name} ${attributes.last_name}`.trim();
      },
    },
  };
}
```

Computed attributes need a `declare` line on the class so they appear on the instance type. Without it, `user.full_name` is a type error even though it works at runtime.

The `satisfies AccessorMap<UserAttrs, User>` form is supported too:

```ts
static accessors = {
  full_name: {
    get: (_value, attributes, model) => /* ... */,
  },
} satisfies AccessorMap<UserAttrs, User>;
```

Both styles get the same parameter narrowing. The annotation form gives clearer errors when callback shapes drift.

See [Models — Accessors and mutators](./models.md#accessors-and-mutators).

## Typed scopes

Static scope methods take a `Builder<TModel>` as their first argument. Annotate with the model class so the scope body has autocomplete:

```ts
import type { Builder } from "@bunnykit/orm";

class User extends Model.define<UserAttrs>("users") {
  static scopeActive(query: Builder<User>) {
    return query.where("active", true);
  }
  static scopeRole(query: Builder<User>, role: string) {
    return query.where("role", role);
  }
}

await User.scope("active").scope("role", "admin").get();
```

The string name in `scope("active")` autocompletes from the available `scope*` methods on the model — `scope("nonexistent")` is a TS error.

## Plain object writes

`create`, `update`, `fill`, and `forceFill` accept partial attribute objects. With `Model.define<T>()`, fields autocomplete and unknown fields are errors:

```ts
await User.create({ name: "Alice", email: "a@b.com" });           // ✓
await User.create({ name: "Alice", nonexistent: true });          // ✗

await user.update({ active: false });                              // ✓
user.fill({ name: "Bob" });
```

Mass-assignment guards (`static fillable` / `static guarded`) silently drop forbidden fields at runtime but do not show up in types — be careful when using `forceCreate` / `forceFill` to bypass them.

## Common pitfalls

- **Accessor parameters widen to `any` without the annotation.** Add `: AccessorMap<TAttrs, TModel>` to `static accessors` (or use `satisfies`).
- **Computed attributes need a `declare`.** Otherwise TS doesn't know `user.full_name` exists.
- **Relation type before `.with()` is the relation method, not its result.** Either eager-load (`User.with("posts").get()`) or call the relation explicitly (`await user.posts().get()`).
- **`getArray()` returns `T[]`, `get()` returns `Collection<T>`.** Pick the right one for the return type of your function.
- **Circular relation imports.** Two models that reference each other will hit a runtime circular import. Use `type`-only imports for the relation type and a lazy require inside the relation method, or split via a `relations.ts` registry.

## Where to next

- [Models](./models.md) — every modeling feature, including soft deletes, scopes, and observers.
- [Query Builder](./query-builder.md) — chainable filters, joins, aggregates.
- [Type Generation](./type-generation.md) — automatic generation of attribute interfaces from your schema.
