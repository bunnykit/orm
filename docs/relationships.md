# Relationships

Relationships describe how rows in one table connect to rows in another. Bunny supports the full Eloquent vocabulary — `hasOne`, `hasMany`, `belongsTo`, `belongsToMany` (many-to-many with a pivot), `hasManyThrough` / `hasOneThrough`, polymorphic relations (`morphTo`, `morphOne`, `morphMany`, `morphToMany`, `morphedByMany`), and one-of-many variants like `latestOfMany`.

A relation is a method on a model class. The method describes the relationship; calling it returns a builder you can chain or terminate just like any other [query builder](./query-builder.md):

```ts
class User extends Model {
  posts() { return this.hasMany(Post); }     // user → many posts
  profile() { return this.hasOne(Profile); } // user → one profile
}

const posts = await user.posts().get();             // Collection<Post>
const drafts = await user.posts().where("published", false).get();
```

The query builder methods available on a relation include filters (`where`), ordering (`orderBy`), eager loads (`with`), and write helpers (`create`, `save`, `attach`). All foreign keys are filled in for you so you don't repeat IDs.

For the typing flow — how `with("posts")` autocompletes and how the result type narrows after eager loading — see [TypeScript](./typescript.md).

## hasMany

One record has many related records. The related table holds the foreign key.

```ts
// Schema
await Schema.create("users", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("posts", (t) => {
  t.increments("id");
  t.integer("user_id"); // foreign key pointing to users.id
  t.string("title");
  t.timestamps();
});

// Models
class User extends Model {
  static table = "users";
  posts() {
    return this.hasMany(Post);
  } // FK: post.user_id
  posts() {
    return this.hasMany(Post, "author_id");
  } // custom FK
}

class Post extends Model {
  static table = "posts";
}

// Usage
const posts = await user.posts().get(); // Collection<Post>
const post = await user.posts().where("published", true).first();
```

## hasOne

One record has exactly one related record.

```ts
// Schema
await Schema.create("profiles", (t) => {
  t.increments("id");
  t.integer("user_id"); // foreign key pointing to users.id
  t.string("bio").nullable();
  t.timestamps();
});

// Model
class User extends Model {
  profile() {
    return this.hasOne(Profile);
  }
}

// Usage
const profile = await user.profile().get(); // Profile | null
```

### hasOne — withDefault

Return a default model instance instead of `null` when the relation is missing:

```ts
class User extends Model {
  profile() {
    return this.hasOne(Profile).withDefault({ bio: "No bio yet" });
  }
}

// No profile row exists → returns an unsaved Profile with bio set
const profile = await user.profile().get();
profile.$exists; // false
profile.getAttribute("bio"); // "No bio yet"

// withDefault() with no args returns an empty unsaved instance
this.hasOne(Profile).withDefault();
```

Default models are also used during eager loading — any model with a missing relation gets the default instead of `null`.

## belongsTo

The model holds the foreign key pointing to the parent.

```ts
// (re-uses the posts/users schema from hasMany above)

// Model
class Post extends Model {
  author() {
    return this.belongsTo(User);
  } // FK: post.user_id
  author() {
    return this.belongsTo(User, "author_id");
  } // custom FK
}

// Usage
const author = await post.author().get(); // User | null
```

### Constrained relations

You can chain `where()` directly inside a relation method. The constraint stays attached to the relation, so lazy loading and eager loading both respect it. When the related column could be ambiguous, qualify it with the related table name.

```ts
class Customer extends Model {
  openInvoices() {
    return this.hasMany(Invoice).where("status", "open");
  }

  primaryContact() {
    return this.hasOne(Contact).where("kind", "primary");
  }

  accountOwner() {
    return this.belongsTo(User).where("users.active", true);
  }

  preferredTags() {
    return this.belongsToMany(Tag, "customer_tag").where("tags.enabled", true);
  }

  coverImage() {
    return this.morphOne(Media, "attachable").where("role", "cover");
  }

  publicAssets() {
    return this.morphMany(Media, "attachable").where("visibility", "public");
  }
}

const customers = await Customer.with("openInvoices", "primaryContact").get();
const customer = customers[0];

const invoices = await customer.openInvoices().where("total", ">", 100).get();
```

### belongsTo — associate / dissociate

Update the foreign key without touching the database directly:

```ts
const post = new Post({ title: "Draft" });
post.author().associate(user); // sets post.user_id = user.id (in memory)
await post.save();

post.author().dissociate(); // sets post.user_id = null (in memory)
await post.save();
```

### belongsTo — withDefault

Return a default model instance instead of `null` when the FK is null or the parent is missing:

```ts
class Post extends Model {
  author() {
    return this.belongsTo(User).withDefault({ name: "Anonymous" });
  }
}

// FK is null → returns an unsaved User with name "Anonymous"
const author = await post.author().get();
author.$exists; // false
author.getAttribute("name"); // "Anonymous"
```

## hasMany — create / saveMany / createMany

Persist related models via a `hasMany` relation. The FK is set automatically.

```ts
const user = await User.find(1);

// create — create a single model and return it
const post = await user.posts().create({ title: "My Post" });
post.$exists; // true
post.getAttribute("user_id"); // user.id

// saveMany — set FK and save each model instance
const p1 = new Post({ title: "First" });
const p2 = new Post({ title: "Second" });
await user.posts().saveMany([p1, p2]);

p1.$exists; // true
p1.getAttribute("user_id"); // user.id

// createMany — create and return multiple models
const posts = await user
  .posts()
  .createMany([{ title: "Alpha" }, { title: "Beta" }]);
posts[0].$exists; // true
posts[0].getAttribute("user_id"); // user.id
```

## hasManyThrough / hasOneThrough

Access distant records through an intermediate model.

```ts
// Schema: countries → users → posts
await Schema.create("countries", (t) => {
  t.increments("id");
  t.string("name");
});
await Schema.create("users", (t) => {
  t.increments("id");
  t.integer("country_id");
  t.string("name");
  t.timestamps();
});
await Schema.create("posts", (t) => {
  t.increments("id");
  t.integer("user_id");
  t.string("title");
  t.timestamps();
});

// Models
class Country extends Model {
  posts() {
    return this.hasManyThrough(Post, User);
    // intermediate FK: users.country_id
    // final FK:        posts.user_id
  }

  latestPost() {
    return this.hasOneThrough(Post, User);
  }
}

// Usage
const posts = await country.posts().get(); // all posts by users in this country

// Override keys: hasManyThrough(Final, Through, throughFK, finalFK, localKey, throughKey)
this.hasManyThrough(Post, User, "country_uuid", "author_id", "uuid", "id");
```

## belongsToMany (Many-to-Many)

Two models are linked through a pivot table.

```ts
// Schema
await Schema.create("users", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("roles", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("role_user", (t) => {
  // pivot: alphabetical model names
  t.integer("user_id");
  t.integer("role_id");
});

// Models
class User extends Model {
  roles() {
    return this.belongsToMany(Role);
  }
}

class Role extends Model {
  users() {
    return this.belongsToMany(User);
  }
}

// Usage
const roles = await user.roles().get(); // Collection<Role>
```

Bunny infers the pivot table name by sorting model names alphabetically: `role_user` for `Role` + `User`.

You can also pass a pivot model as the second argument. In that form Bunny uses the pivot model's table name and still infers the pivot keys from the parent and related model names:

```ts
class Section extends Model {
  static table = "sections";

  students() {
    return this.belongsToMany(Student, Offering);
  }
}

class Student extends Model {
  static table = "students";
}

class Offering extends Model {
  static table = "offerings";
}
```

This uses `offerings` as the pivot table, `section_id` as the parent pivot key, and `student_id` as the related pivot key.

### Pivot Columns and Timestamps

```ts
// Select specific columns from the pivot table
class User extends Model {
  roles() {
    return this.belongsToMany(Role)
      .withPivot("is_active", "expires_at")
      .withTimestamps(); // also select pivot created_at / updated_at
  }
}

const roles = await user.roles().get();
roles[0].pivot.is_active; // pivot data attached to each related model
roles[0].pivot.expires_at;
roles[0].pivot.created_at;
```

### Renaming the Pivot Accessor

Use `.as()` to rename `.pivot` to something more descriptive:

```ts
class User extends Model {
  subscriptions() {
    return this.belongsToMany(Plan)
      .as("subscription")
      .withPivot("expires_at", "trial_ends_at");
  }
}

const plans = await user.subscriptions().get();
plans[0].subscription.expires_at; // renamed from .pivot
```

### Attaching, Detaching & Syncing

```ts
// Attach — add rows to the pivot table
await user.roles().attach([1, 2, 3]);
await user.roles().attach(1, { is_active: true }); // with pivot attributes

// Detach — remove rows from the pivot table
await user.roles().detach([2, 3]);
await user.roles().detach(); // detach all

// Sync — keep only the given IDs (detaches all others)
await user.roles().sync([1, 2]);

// syncWithoutDetaching — add new IDs, never remove existing ones
await user.roles().syncWithoutDetaching([3, 4]);
```

### Creating and saving through a relation

`belongsToMany()` and `morphToMany()` can also create or save related models directly. Any fixed `where()` constraints are applied to the related model before save, and any fixed `wherePivot()` constraints are injected into the pivot row.

```ts
class Post extends Model {
  featuredTags() {
    return this.belongsToMany(Tag, "post_tag")
      .withPivot("type")
      .where("name", "Featured")
      .wherePivot("type", "featured");
  }
}

const post = await Post.first();
if (!post) return;

await post.featuredTags().create({ name: "Ignored" });

const tag = new Tag({ name: "Ignored" });
await post.featuredTags().save(tag);

await post
  .featuredTags()
  .createMany([{ name: "Ignored 1" }, { name: "Ignored 2" }]);

await post
  .featuredTags()
  .saveMany([new Tag({ name: "Ignored 3" }), new Tag({ name: "Ignored 4" })]);
```

The constrained fields do not appear in IntelliSense for the create helpers, because Bunny fills them from the relation itself.

### Updating Existing Pivot Rows

Update pivot columns for a specific related record without detaching and re-attaching:

```ts
await user.roles().updateExistingPivot(roleId, {
  is_active: false,
  expires_at: "2025-12-31",
});
```

### Toggle

Attach IDs that aren't attached, detach IDs that are. Returns the lists of what changed:

```ts
const result = await user.roles().toggle([1, 2, 3]);
result.attached; // IDs that were newly attached
result.detached; // IDs that were removed

await user.roles().toggle(4); // single ID
```

### Filtering by Pivot Columns

```ts
const active = await user.roles().wherePivot("is_active", true).get();
const heavy = await user.skills().wherePivot("weight", ">", 5).get();
const mixed = await user
  .skills()
  .wherePivot("weight", ">", 5)
  .orWherePivot("featured", true)
  .get();
const some = await user.roles().wherePivotIn("priority", [1, 2]).get();
const others = await user.roles().wherePivotNotIn("priority", [3, 4]).get();
const unset = await user.tags().wherePivotNull("expires_at").get();
const expiring = await user.tags().wherePivotNotNull("expires_at").get();
const ranked = await user.skills().wherePivotBetween("weight", [5, 10]).get();
const flagged = await user
  .roles()
  .wherePivot("priority", 1)
  .orWherePivotIn("priority", [2, 3])
  .orWherePivotNull("priority")
  .get();
```

Use `withPivotValue()` when a relation should always read and write a fixed pivot value. The value is applied as a pivot filter and is also injected into `attach()`, `sync()`, `save()`, and `create()` pivot rows:

```ts
class User extends Model {
  primaryRoles() {
    return this.belongsToMany(Role).withPivotValue("scope", "primary");
  }
}

await user.primaryRoles().attach(role.id); // pivot.scope = "primary"
const roles = await user.primaryRoles().get(); // only scope = "primary"
```

Pivot filters are also preserved in constrained eager loading. For `belongsToMany` and `morphToMany` relations, the eager-load callback receives a pivot-aware builder, so pivot helpers work there too:

```ts
const users = await User.with({
  roles: (q) =>
    q.wherePivot("is_active", true).wherePivotNotNull("approved_at"),
}).get();
```

## One-of-Many

Convert a `hasMany` into a single "latest", "oldest", or aggregate-selected record:

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

const post = await user.latestPost().get(); // Post | null
```

## Eager Loading

### with() — Load Relations Upfront

```ts
// Load one or more relations
const users = await User.with("posts", "profile").get();
const posts = await Post.with("author").get();

// Nested relations via dot notation
const users = await User.with("posts.comments").get();

// Constrained eager loading — filter within the loaded relation
const users = await User.with({
  posts: (q) => q.where("status", "published").orderBy("created_at", "desc"),
}).get();

// Pivot-aware eager loading — available on belongsToMany / morphToMany relations
const sections = await Section.with({
  subjects: (q) => q.wherePivot("semester_id", params.semester_id),
}).get();

// Nested constraint — the callback is typed to the model at the end of the path
const semesters = await Semester.with({
  "sections.offerings.registrationSubjects": (q) =>
    q.where("enrolled", true).with("subject"),
}).get();

// Multiple constraints combined
const users = await User.with(
  { posts: (q) => q.where("status", "published") },
  { "posts.comments": (q) => q.where("approved", true) },
).get();
```

### load() — Lazy Load on Existing Model

```ts
await user.load("posts");

// With constraint
await user.load({
  posts: (query) => query.where("status", "published"),
});
```

### Typed Eager Load Results

When models use `Model.define<T>()`, relation names autocomplete and results are fully typed:

```ts
// All of these autocomplete and are type-checked:
Semester.with("sections");
Semester.with("sections.offerings");
Semester.with("sections.offerings.subjects");

// After eager loading, the relation type narrows automatically
const years = await AcademicCalendar.with(
  "semesters",
  "semesters.gradingPeriods",
).get();

years[0].semesters; // Collection<Semester>  ✓
years[0].semesters[0].gradingPeriods; // Collection<GradingPeriod>  ✓
```

Without `with()`, `years[0].semesters` stays as `() => HasMany<Semester>` (the relation method).

| Relation type   | Loaded type     |
| --------------- | --------------- |
| `hasMany`       | `Collection<R>` |
| `belongsToMany` | `Collection<R>` |
| `morphMany`     | `Collection<R>` |
| `morphToMany`   | `Collection<R>` |
| `hasOne`        | `R \| null`     |
| `belongsTo`     | `R \| null`     |
| `morphOne`      | `R \| null`     |

## Relation Queries

### has / doesntHave

Filter parent models by whether a relation exists:

```ts
const usersWithPosts = await User.has("posts").get();
const usersWithoutPosts = await User.doesntHave("posts").get();
```

### whereHas / orWhereHas / whereDoesntHave

Filter by related record properties:

```ts
const usersWithPublished = await User.whereHas("posts", (q) => {
  q.where("status", "published");
}).get();

const usersWithPublishedOrFeatured = await User.whereHas("posts", (q) =>
  q.where("status", "published"),
)
  .orWhereHas("posts", (q) => q.where("featured", true))
  .get();

const usersWithoutSpam = await User.whereDoesntHave("posts", (q) => {
  q.where("spam", true);
}).get();
```

The same pivot-aware callback behavior applies to `whereHas()` and `whereDoesntHave()` when the relation is a `belongsToMany` or `morphToMany`.

### withExists

Add a relation-exists field. The alias is included as `boolean` in model JSON and paginated JSON types:

```ts
const pageResult = await Subject.withExists(
  "offerings",
  "in_used",
  (offering) => {
    offering.has("admissions");
  },
)
  .whereNull("parent_id")
  .orderBy("title")
  .paginate(15, 1);

const json = pageResult.json();
json.data[0].in_used; // boolean

// Example record:
json.data[0];
// {
//   id: 1,
//   title: "Mathematics",
//   parent_id: null,
//   in_used: true
// }
```

Supported forms:

```ts
Subject.withExists("offerings");
// adds: offerings_exists: boolean

Subject.withExists("offerings", (offering) => offering.has("admissions"));
// adds: offerings_exists: boolean

Subject.withExists("offerings", "in_used", (offering) =>
  offering.has("admissions"),
);
// adds: in_used: boolean

Subject.withExists({
  offerings: (offering) => offering.has("admissions"),
  "offerings as in_used": (offering) => offering.has("admissions"),
});
// adds: offerings_exists: boolean, in_used: boolean
```

### whereRelation / orWhereRelation

Shorthand for `whereHas` when you just need to check one column on the related model:

```ts
// Posts that have at least one approved comment
const posts = await Post.whereRelation("comments", "status", "approved").get();

// With operator
const posts = await Post.whereRelation("comments", "votes", ">", 10).get();

// OR variant
const posts = await Post.whereRelation("comments", "status", "approved")
  .orWhereRelation("comments", "status", "featured")
  .get();
```

### whereBelongsTo / whereAttachedTo

Use model instances as relation filters without spelling out foreign keys or pivot joins:

```ts
class Post extends Model {
  author() {
    return this.belongsTo(User, "author_id");
  }

  tags() {
    return this.belongsToMany(Tag, "post_tag");
  }
}

const author = await User.where("email", "ada@example.com").first();
if (!author) return;

// Posts whose author() belongsTo the given user.
const posts = await Post.whereBelongsTo("author", author).get();
```

`whereAttachedTo()` works with `belongsToMany()` and `morphToMany()` relations. Pivot constraints, morph constraints, and related-model constraints defined on the relation still apply because the shortcut uses the relation existence query:

```ts
const tag = await Tag.where("slug", "release-notes").first();
if (!tag) return;

const taggedPosts = await Post.whereAttachedTo("tags", tag).get();

// Multiple related models are supported too.
const selectedTags = await Tag.whereIn("slug", [
  "release-notes",
  "guide",
]).get();
const posts = await Post.whereAttachedTo("tags", selectedTags).get();

// It also works in the middle of a query chain.
const publishedTaggedPosts = await Post.query()
  .whereAttachedTo("tags", tag)
  .where("status", "published")
  .latest()
  .get();
```

The first argument is always the relationship name and is typed for IntelliSense: `whereBelongsTo()` suggests only `belongsTo` relations, while `whereAttachedTo()` suggests only `belongsToMany` and `morphToMany` relations. The related model or collection is required as the second argument.

### withWhereHas

Filter parent models and eager load the filtered relation in one call:

```ts
// Only users who have published posts — and also load those posts
const users = await User.withWhereHas("posts", (q) =>
  q.where("status", "published"),
).get();

users[0].getRelation("posts"); // only published posts, already loaded
```

### Relation Aggregates

Add aggregate columns from a relation without loading the related records:

```ts
const users = await User.withCount("posts")
  .withSum("posts", "views")
  .withAvg("posts", "score")
  .withMin("posts", "created_at")
  .withMax("posts", "created_at")
  .get();

users[0].posts_count; // number of posts
users[0].posts_sum_views; // sum of views across all posts
```

Aggregate methods support constrained subqueries with the same relation-aware callback style:

```ts
const users = await User.withAvg("posts", "score", (post) =>
  post.where("status", "published"),
)
  .withMax("posts", "created_at", "latest_published_post_at", (post) =>
    post.where("status", "published"),
  )
  .get();

users[0].posts_avg_score; // average score for published posts
users[0].latest_published_post_at; // max created_at for published posts
```

Supported aggregate overloads:

```ts
User.withAvg("posts", "score");
User.withAvg("posts", "score", (post) => post.where("status", "published"));
User.withAvg("posts", "score", "published_score_avg");
User.withAvg("posts", "score", "published_score_avg", (post) =>
  post.where("status", "published"),
);
```

The same overloads are available for `withSum`, `withMin`, and `withMax`. The relation name autocompletes from model relations, and the column argument autocompletes from the related model.

### loadMissing — Lazy Load Missing Relations on a Collection

Load relations for collection items that don't have them yet. Already-loaded relations are preserved:

```ts
const posts = await Post.where("status", "published").get();
// posts[0].getRelation("author") === undefined — not loaded yet

await posts.loadMissing("author", "comments");

posts[0].getRelation("author"); // User — now loaded
posts[0].getRelation("comments"); // Collection<Comment> — now loaded

// Safe to call multiple times — only triggers queries for truly missing relations
posts[0].setRelation("author", sentinel);
await posts.loadMissing("author"); // author is already set, skipped
```

### Post-retrieval Aggregate Loaders

Load relation aggregates after you already have a model or collection:

```ts
const user = await User.first();
if (!user) return;

await user.loadCount("posts");
await user.loadSum("posts", "views", "total_views");
await user.loadAvg("posts", "score");
await user.loadMin("posts", "created_at");
await user.loadMax("posts", "created_at", "latest_post_at");

const users = await User.where("active", true).get();
await users.loadCount("posts");
```

The loaders mutate the model(s) in place and return the same value with the aggregate fields attached. The relation name and related columns are typed, so IntelliSense follows the model relation and the related model columns.

Assumptions for IntelliSense:

- Use the awaited return value if you want the aggregate fields available on a local variable type.
- Guard nullable lookups like `await User.first()` before calling the loaders.
- The generated field names follow the same default aliases as `withCount()`, `withSum()`, `withAvg()`, `withMin()`, and `withMax()`.

## Polymorphic Relations

```ts
import { Model, MorphMap } from "@bunnykit/orm";

// Schema
await Schema.create("comments", (t) => {
  t.increments("id");
  t.string("commentable_type"); // e.g. "Post" or "Video"
  t.integer("commentable_id");
  t.text("body");
  t.timestamps();
});

// Register morph types so morphTo knows which model to instantiate
MorphMap.register("Post", Post);
MorphMap.register("Video", Video);

class Comment extends Model {
  commentable() {
    return this.morphTo("commentable"); // reads commentable_type / commentable_id
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

// Usage
const comments = await Comment.with("commentable").get();
comments[0].getRelation("commentable"); // Post | Video | null

const postComments = await post.comments().get(); // Collection<Comment>
```

### Creating morph records

`morphMany()` and `morphOne()` relations can create records directly through the relation. The morph columns are filled automatically, and any fixed `where()` constraints are excluded from the input type and applied for you at write time.

```ts
const student = await Student.first();
if (!student) return;

await student.attachments().attach({
  filename: "transcript.pdf",
});

await student
  .attachments()
  .attachMany([
    { filename: "id-card-front.jpg" },
    { filename: "id-card-back.jpg" },
  ]);

await student.profilePicture().attach({
  filename: "profile.jpg",
});
```

For `profilePicture()`, `collection` is injected from the relation constraint, so it does not appear in IntelliSense. Also avoid optional chaining on the relation call itself if you want method autocomplete; guard the model first, as above.

### Morph-to query helpers

`whereHasMorph()` and `whereDoesntHaveMorph()` let you filter a `morphTo` relation by the concrete types it can point to. The callback receives the related model query for each type. For eager loading, the `with()` callback receives the `MorphTo` relation itself, so `morphWith()` and `morphWithCount()` are available in IntelliSense.

```ts
const comments = await Comment.whereHasMorph(
  "commentable",
  [Post, Video],
  (query) => {
    query.where("title", "Morph target");
  },
).get();

const missingVideos = await Comment.whereDoesntHaveMorph("commentable", [
  Video,
]).get();

const post = await Post.firstOrFail();

const onThisPost = await Comment.whereMorphedTo("commentable", post).get();

const onAnyPost = await Comment.whereMorphedTo("commentable", Post).get();

const notThisPost = await Comment.whereNotMorphedTo("commentable", post).get();

const postOrVideo = await Comment.whereMorphedTo("commentable", post)
  .orWhereMorphedTo("commentable", "Video")
  .get();

const loaded = await Comment.with({
  commentable: (relation) =>
    relation
      .morphWith({
        Post: ["comments"],
        Video: ["thumbnail"],
      })
      .morphWithCount({
        Post: ["comments"],
      }),
}).get();

await loaded.loadMorph("commentable", {
  Post: ["comments"],
  Video: ["thumbnail"],
});
```

Assumptions for IntelliSense:

- `morphWith()` and `morphWithCount()` are only available inside the `with({ commentable: (relation) => ... })` callback, because that callback is typed as the `MorphTo` relation.
- `whereHasMorph()` and `whereDoesntHaveMorph()` callbacks are typed to the related model query, so builder methods are available there instead.
- `whereMorphedTo()`, `orWhereMorphedTo()`, and `whereNotMorphedTo()` only accept typed `morphTo` relation names. Passing an instance filters by both morph type and ID; passing a model class or morph type string filters by type.
- `loadMorph()` is available on `Model` instances and collections, and the morph relation name should be one of the model's typed morph relations.
- Fixed relation fields stay out of write-input IntelliSense when Bunny injects them from the relation itself.

## Customizing Morph Type

```ts
class Post extends Model {
  static morphName = "post"; // stored in {name}_type column as "post" instead of "Post"
}
```

## Many-to-Many Polymorphic

```ts
// Schema
await Schema.create("tags", (t) => {
  t.increments("id");
  t.string("name");
  t.timestamps();
});
await Schema.create("taggables", (t) => {
  t.integer("tag_id");
  t.integer("taggable_id");
  t.string("taggable_type"); // "Post", "Video", etc.
});

// Models
class Post extends Model {
  tags() {
    return this.morphToMany(Tag, "taggable");
  }

  importantTags() {
    return this.morphToMany(Tag, "taggable")
      .withPivot("scope")
      .where("name", "Important")
      .wherePivot("scope", "important");
  }
}

class Tag extends Model {
  posts() {
    return this.morphedByMany(Post, "taggable");
  }
  videos() {
    return this.morphedByMany(Video, "taggable");
  }
}

// Usage
const tags = await post.tags().get(); // Collection<Tag>
const posts = await tag.posts().get(); // Collection<Post>

const post = await Post.first();
if (!post) return;

await post.importantTags().create({ name: "Ignored" });
await post.importantTags().save(new Tag({ name: "Ignored" }));
```

`morphToMany()` supports the same `create`, `createMany`, `save`, and `saveMany` helpers as `belongsToMany()`. Relation constraints are applied automatically, and constrained fields stay out of IntelliSense for the write input.

## Common pitfalls

- **N+1 queries.** Iterating a collection and accessing relations triggers one query per parent row. Always pre-load with `.with("rel")` higher up the chain. Enable `Model.preventLazyLoading = true` in development to surface accidental lazy loads as errors.
- **Pivot table naming.** `belongsToMany(Role)` infers the pivot name by alphabetically sorting model names (`role_user`). If your pivot table uses a different name, pass it explicitly: `belongsToMany(Role, "user_roles")`. Or pass a pivot model class as the second argument to reuse its table name and let key inference handle the rest.
- **Polymorphic types not registered.** `morphTo("commentable")` needs each concrete model registered via `MorphMap.register("Post", Post)`, otherwise the relation resolves to `null`. Do this at app startup, not inside the model file (avoids circular imports).
- **Constraint methods on a relation are sticky.** `hasMany(Post).where("published", true)` filters eagerly and lazily. To opt out for a single call, build the query manually: `Post.where("user_id", user.id).get()`.
- **`attach` without `withPivot`.** Pivot data passed to `attach(id, { extra: ... })` is dropped on read unless the relation declares `.withPivot("extra")`. Add the columns explicitly so they round-trip.
- **`with()` joins on `belongsToMany` can produce duplicates.** Eager loading dedupes parents automatically, but if you also use manual joins, add `.distinct()` or rely on the relation aggregate variants (`withCount`, `withExists`).
- **`load()` ignores already-loaded relations.** If you mutate `setRelation()` between fetches, `load()` won't overwrite. Use `loadMissing()` for "load only if missing", or call `model.unsetRelation("rel")` first to force a refresh.

## Where to next

- [Query Builder — Relation Queries](./query-builder.md#relation-queries) — `has`, `whereHas`, `withWhereHas`, and friends.
- [Models](./models.md) — the lifecycle hooks (`touches`, accessors, observers) that fire when related models change.
- [Schema Builder](./schema-builder.md#foreign-keys) — designing the foreign keys and polymorphic columns your relations depend on.
- [TypeScript](./typescript.md) — how relation names autocomplete and how eager-loaded results narrow.
