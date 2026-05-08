# Bunny

An **Eloquent-inspired ORM** built specifically for [Bun](https://bun.sh)'s native `bun:sql` client. Supports **SQLite**, **MySQL**, and **PostgreSQL** with full TypeScript typing, a chainable query builder, schema migrations, model observers, and polymorphic relations.

---

## Features

- 🔥 **Bun-native** — Built on top of `bun:sql` for maximum performance
- 📦 **Multi-database** — SQLite, MySQL, and PostgreSQL support
- 🔷 **Fully Typed** — Written in TypeScript with generics everywhere
- 🏗️ **Schema Builder** — Programmatic table creation, indexes, foreign keys
- 🔍 **Query Builder** — Chainable `where`, `join`, `orderBy`, `groupBy`, etc.
- 🧬 **Eloquent-style Models** — Property attributes, defaults, casts, dirty tracking, soft deletes, scopes
- 🔗 **Relations** — Standard, many-to-many, polymorphic, through, one-of-many, and relation queries
- 👁️ **Observers** — Lifecycle hooks (`creating`, `created`, `updating`, `updated`, etc.)
- 🚀 **Migrations & CLI** — Create, run, and rollback migrations from the command line

---

## Installation

```bash
bun add @bunnykit/orm
```

> **Note:** This package is Bun-only. Install and run it with Bun >= 1.1; npm, yarn, pnpm, and Node.js runtime usage are not supported.

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
  migrationsPath: "./database/migrations",
};
```

Or use environment variables:

```bash
export DATABASE_URL="sqlite://app.db"
export MIGRATIONS_PATH="./database/migrations"
```

---

## Quick Start

### Define a Model

```ts
import { Model } from "@bunnykit/orm";

class User extends Model {
  // Optional — inferred as "users" if omitted
  static table = "users";

  posts() {
    return this.hasMany(Post);
  }
}

class Post extends Model {
  static table = "posts";

  author() {
    return this.belongsTo(User);
  }
}
```

### Set the Database Connection

```ts
import { Connection, Model, Schema } from "@bunnykit/orm";

const connection = new Connection({ url: "sqlite://app.db" });
Model.setConnection(connection);
Schema.setConnection(connection);
```

### Create Tables

```ts
import { Schema } from "@bunnykit/orm";

await Schema.create("users", (table) => {
  table.increments("id");
  table.string("name");
  table.string("email").unique();
  table.timestamps(); // created_at & updated_at
});

await Schema.create("posts", (table) => {
  table.increments("id");
  table.integer("user_id").unsigned();
  table.string("title");
  table.text("body").nullable();
  table.timestamps();
});
```

### CRUD Operations

```ts
// Create
const user = await User.create({ name: "Alice", email: "alice@example.com" });

// Find
const found = await User.find(1);

// Query
const adults = await User.where("age", ">=", 18)
  .orderBy("name")
  .get();

// Update
user.name = "Alice Smith";
await user.save();

// Delete
await user.delete();
```

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

| Method | Description |
|--------|-------------|
| `increments(name)` | Auto-incrementing integer primary key |
| `bigIncrements(name)` | Auto-incrementing big integer |
| `string(name, length=255)` | VARCHAR |
| `text(name)` | TEXT |
| `integer(name)` | INTEGER |
| `bigInteger(name)` | BIGINT |
| `smallInteger(name)` | SMALLINT |
| `tinyInteger(name)` | TINYINT |
| `float(name, p=8, s=2)` | FLOAT |
| `double(name, p=8, s=2)` | DOUBLE |
| `decimal(name, p=8, s=2)` | DECIMAL |
| `boolean(name)` | BOOLEAN |
| `date(name)` | DATE |
| `dateTime(name)` | DATETIME |
| `time(name)` | TIME |
| `timestamp(name)` | TIMESTAMP |
| `json(name)` | JSON |
| `jsonb(name)` | JSONB (Postgres) |
| `binary(name)` | BLOB / BYTEA |
| `uuid(name)` | UUID |
| `enum(name, values)` | ENUM |

### Column Modifiers

```ts
table.string("email").unique();     // UNIQUE index
table.string("slug").index();       // INDEX
table.string("name").nullable();    // NULLABLE
table.integer("role").default(1);   // DEFAULT value
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
```

---

## Query Builder

Every model exposes a query builder via static methods:

```ts
// Static entry points
User.where("active", true);
User.where({ role: "admin", active: true });
User.whereIn("id", [1, 2, 3]);
User.whereNull("deleted_at");
User.whereNotNull("email");

// Chaining
const results = await User
  .where("age", ">=", 18)
  .whereIn("role", ["admin", "moderator"])
  .orderBy("created_at", "desc")
  .limit(10)
  .offset(0)
  .get();

// Aggregates
const count = await User.where("active", true).count();
const exists = await User.where("email", "test@example.com").exists();

// Joins
const posts = await Post
  .query()
  .select("posts.*", "users.name as author_name")
  .join("users", "posts.user_id", "=", "users.id")
  .get();

// Pluck
const emails = await User.pluck("email");

// First / Find
const user = await User.where("email", "alice@example.com").first();
const byId = await User.find(1);
```

---

## Models

### Conventions

- **Table name**: inferred from the class name in `snake_case` + plural `s`.
  - `class User` → table `users`
  - `class BlogPost` → table `blog_posts`
- **Primary key**: defaults to `id`
- **Timestamps**: `created_at` and `updated_at` are managed automatically (disable with `static timestamps = false`)

### Defining Models

```ts
class Product extends Model {
  static table = "products";       // override table name
  static primaryKey = "sku";       // override primary key
  static timestamps = false;        // disable timestamps
  static softDeletes = true;        // use deleted_at instead of hard deletes

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

### Model Methods

```ts
// Static
const all = await User.all();
const user = await User.create({ name: "Alice" });
const found = await User.find(1);
const first = await User.first();
const builder = User.where("active", true);

// Instance
user.fill({ name: "Bob", email: "bob@example.com" });
user.name;                 // property access
user.name = "Charlie";     // property assignment
user.getAttribute("name"); // explicit access still works
user.setAttribute("name", "Dana");
user.isDirty();           // true if attributes changed
user.getDirty();          // { name: "Charlie" }
await user.save();
await user.delete();
await user.refresh();
user.toJSON();            // plain object
```

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

const user = new User({
  active: true,
  settings: { theme: "dark" },
});

user.$attributes.active;   // 1
user.active;               // true
user.settings.theme;       // "dark"
```

Supported built-in casts:

| Cast | Behavior |
|------|----------|
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

### Soft Deletes

Enable soft deletes with `static softDeletes = true` and a `deleted_at` column:

```ts
class User extends Model {
  static softDeletes = true;
}

await user.delete();       // sets deleted_at
await user.restore();      // clears deleted_at
await user.forceDelete();  // permanently deletes

await User.all();                  // excludes trashed rows
await User.withTrashed().get();    // includes trashed rows
await User.onlyTrashed().get();    // only trashed rows
await User.onlyTrashed().restore();
```

### Scopes

Local scopes are static methods named `scopeName`:

```ts
class User extends Model {
  static scopeActive(query) {
    return query.where("active", true);
  }
}

const users = await User.scope("active").get();
```

Global scopes apply automatically to all queries:

```ts
User.addGlobalScope("tenant", (query) => {
  query.where("tenant_id", 1);
});

await User.withoutGlobalScope("tenant").get();
await User.withoutGlobalScopes().get();
```

---

## Relationships

### Standard Relations

```ts
class User extends Model {
  posts() {
    return this.hasMany(Post);           // foreignKey: user_id, localKey: id
  }

  profile() {
    return this.hasOne(Profile);         // foreignKey: user_id, localKey: id
  }
}

class Post extends Model {
  author() {
    return this.belongsTo(User);         // foreignKey: user_id, ownerKey: id
  }
}
```

Keys are **automatically inferred** from the model names. You can override them:

```ts
this.hasMany(Post, "author_id", "uuid");
this.belongsTo(User, "author_id", "uuid");
```

### Belongs To Helpers

Use `associate` and `dissociate` to update the foreign key for a `belongsTo` relation:

```ts
const post = new Post({ title: "Draft" });
post.author().associate(user);
post.user_id; // user's id

post.author().dissociate();
post.user_id; // null
```

### Through Relations

Use `hasManyThrough` and `hasOneThrough` for distant relations through an intermediate model:

```ts
class Country extends Model {
  posts() {
    return this.hasManyThrough(Post, User);
  }

  profile() {
    return this.hasOneThrough(Profile, User);
  }
}
```

By convention, Bunny expects:

- intermediate table foreign key to parent: `country_id`
- final table foreign key to intermediate: `user_id`

You can override keys:

```ts
this.hasManyThrough(Post, User, "country_uuid", "author_id", "uuid", "id");
this.hasOneThrough(Profile, User, "country_id", "user_id");
```

### One-of-Many Relations

Convert a `hasMany` relation into a single latest, oldest, or aggregate-selected relation:

```ts
class User extends Model {
  posts() {
    return this.hasMany(Post);
  }

  latestPost() {
    return this.posts().latestOfMany("id");
  }

  oldestPost() {
    return this.posts().oldestOfMany("id");
  }

  highestScoringPost() {
    return this.posts().ofMany("score", "max");
  }
}

const post = await user.latestPost().getResults();
```

### Relation Queries and Aggregates

Filter models by related records:

```ts
const usersWithPosts = await User.has("posts").get();

const usersWithPublishedPosts = await User.whereHas("posts", (query) => {
  query.where("status", "published");
}).get();

const usersWithoutPosts = await User.doesntHave("posts").get();
```

Add relation aggregate columns:

```ts
const users = await User
  .withCount("posts")
  .withSum("posts", "views")
  .withAvg("posts", "score")
  .withMin("posts", "created_at")
  .withMax("posts", "created_at")
  .get();

users[0].posts_count;
users[0].posts_sum_views;
```

### Polymorphic Relations

```ts
import { Model, MorphMap } from "@bunnykit/orm";

// Register morph types so morphTo knows which model to instantiate
MorphMap.register("Post", Post);
MorphMap.register("Video", Video);

class Comment extends Model {
  commentable() {
    return this.morphTo("commentable");  // reads commentable_type / commentable_id
  }
}

class Post extends Model {
  comments() {
    return this.morphMany(Comment, "commentable");
  }
}

class Video extends Model {
  comments() {
    return this.morphMany(Comment, "commentable");
  }

  thumbnail() {
    return this.morphOne(Image, "imageable");
  }
}
```

### Many-to-Many Polymorphic

```ts
class Post extends Model {
  tags() {
    return this.morphToMany(Tag, "taggable");
  }
}

class Tag extends Model {
  posts() {
    return this.morphedByMany(Post, "taggable");
  }
}
```

Pivot table: `taggables(tag_id, taggable_id, taggable_type)`.

### Customizing Morph Type

```ts
class Post extends Model {
  static morphName = "post";   // stored in {name}_type column
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

## Migrations

### CLI Commands

```bash
# Create a new migration file
bun run bunny migrate:make CreateUsersTable

# Run all pending migrations
bun run bunny migrate

# Rollback the last batch
bun run bunny migrate:rollback

# Show migration status
bun run bunny migrate:status
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

### Auto Type Generation

If you set `typesOutDir` in your config, types are **automatically regenerated** after every `migrate` and `migrate:rollback`:

```bash
bun run bunny migrate
# → Migrated: 2026xxxx_create_users_table.ts
# → Regenerated types in ./src/generated/models
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

## TypeScript Tips

### Typing Model Attributes

```ts
interface UserAttributes {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

class User extends Model {
  static table = "users";
}

// Type inference works automatically on static methods
const user = await User.create({ name: "Alice", email: "a@example.com" });
// user is typed as User
```

### Query Builder Typing

```ts
// Builder<T> is inferred from the model class
const builder = User.where("name", "Alice"); // Builder<User>
const users: User[] = await builder.get();
```

---

## Type Generation (IntelliSense)

Bunny can introspect your database schema and generate TypeScript declaration files for your existing models. This gives you **full IntelliSense** for model properties without changing your model source files:

```ts
const user = await User.first();
user.name;        // ✅ autocomplete + type-checking
user.email = "a@example.com";  // ✅ typed setter
```

### Generate Types

```bash
# Generate into default directory (./generated/models)
bun run bunny types:generate

# Generate into a custom directory
bun run bunny types:generate ./src/generated
```

Or configure in `bunny.config.ts`:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  migrationsPath: "./database/migrations",
  typesOutDir: "./src/generated/model-types", // auto-regenerate .d.ts files on every migration
  typeDeclarationImportPrefix: "../models",
  // Optional overrides for non-conventional model names or paths:
  typeDeclarations: {
    admin_users: { path: "../models/AdminAccount", className: "AdminAccount" },
  },
};
```

With `typeDeclarationImportPrefix`, Bunny conventionally maps tables to singular PascalCase model modules:

| Table | Generated augmentation |
|-------|------------------------|
| `users` | `../models/User` / `User` |
| `blog_posts` | `../models/BlogPost` / `BlogPost` |
| `categories` | `../models/Category` / `Category` |

Set `typeDeclarationSingularModels: false` if your model classes use plural names.

### Using Generated Declarations

For each table, Bunny generates an `Attributes` interface. If you configure `typeDeclarations`, it also augments your real model class:

```ts
// generated/model-types/users.d.ts
export interface UsersAttributes {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
}

declare module "../models/User" {
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

Editors that include the generated `.d.ts` files in `tsconfig.json` will understand `user.name`, `user.email`, etc. The generated files can be safely **gitignored** and regenerated whenever your schema changes.

If you still want generated base classes, use the programmatic generator with `{ stubs: true }`.

### Manual Typing (Without Codegen)

If you prefer not to use codegen, you can pass a type parameter directly:

```ts
interface UserAttributes {
  id: number;
  name: string;
  email: string;
}

class User extends Model<UserAttributes> {
  static table = "users";
}

// $attributes and getAttribute are now typed
const user = await User.first();
user.getAttribute("name"); // string
user.$attributes.email;    // string
```

---

## Testing

Bunny includes a full test suite built with `bun:test`.

```bash
bun test
```

92 tests covering connection management, schema grammars, query builder, model CRUD, casts, scopes, soft deletes, relations, observers, migrations, and type generation.

---

## License

MIT
