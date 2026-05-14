import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, MorphMap, Builder, Connection, Collection } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class MComment extends Model {
  static table = "m_comments";
  commentable() {
    return this.morphTo("commentable");
  }
}

class MPost extends Model {
  static table = "m_posts";
  comments() {
    return this.morphMany(MComment, "commentable");
  }
  importantTags() {
    return this.morphToMany(MTag, "taggable", "taggables", "taggable_id", "tag_id")
      .withPivot("scope")
      .where("name", "Important")
      .wherePivot("scope", "important");
  }
  tags() {
    return this.morphToMany(MTag, "taggable", "taggables", "taggable_id", "tag_id");
  }
}

class MVideo extends Model {
  static table = "m_videos";
  comments() {
    return this.morphMany(MComment, "commentable");
  }
  thumbnail() {
    return this.morphOne(MImage, "imageable");
  }
}

class MImage extends Model {
  static table = "m_images";
  imageable() {
    return this.morphTo("imageable");
  }
}

class MStudent extends Model {
  static table = "m_students";
  attachments() {
    return this.morphMany(MAttachment, "attachable");
  }
  profilePicture() {
    return this.morphOne(MAttachment, "attachable").where("collection", "profile_picture");
  }
}

class MAttachment extends Model {
  static table = "m_attachments";
}

class MTag extends Model {
  static table = "m_tags";
  posts() {
    return this.morphedByMany(MPost, "taggable", undefined, "tag_id", "taggable_id");
  }
}

describe("Polymorphic Relations", () => {
  let connection: ReturnType<typeof setupTestDb>;

  beforeAll(async () => {
    connection = setupTestDb();
    MorphMap.register("MPost", MPost);
    MorphMap.register("MVideo", MVideo);
    MorphMap.register("MImage", MImage);

    await Schema.create("m_posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("m_videos", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("m_comments", (table) => {
      table.increments("id");
      table.text("body");
      table.integer("commentable_id");
      table.string("commentable_type");
      table.timestamps();
    });
    await Schema.create("m_images", (table) => {
      table.increments("id");
      table.string("url");
      table.integer("imageable_id");
      table.string("imageable_type");
      table.timestamps();
    });
    await Schema.create("m_students", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("m_attachments", (table) => {
      table.increments("id");
      table.integer("attachable_id");
      table.string("attachable_type");
      table.string("collection").nullable();
      table.string("filename").nullable();
      table.timestamps();
    });
    await Schema.create("taggables", (table) => {
      table.increments("id");
      table.integer("tag_id");
      table.integer("taggable_id");
      table.string("taggable_type");
      table.string("scope").nullable();
      table.integer("priority").nullable();
      table.timestamps();
    });
    await Schema.create("m_tags", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
  });

  test("morphMany returns only matching type", async () => {
    const post = await MPost.create({ title: "Post 1" });
    const video = await MVideo.create({ title: "Video 1" });

    await MComment.create({ body: "Post comment", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "Video comment", commentable_id: video.getAttribute("id"), commentable_type: "MVideo" });

    const postComments = await post.comments().getResults();
    expect(postComments).toHaveLength(1);
    expect(postComments[0].getAttribute("body")).toBe("Post comment");

    const videoComments = await video.comments().getResults();
    expect(videoComments).toHaveLength(1);
    expect(videoComments[0].getAttribute("body")).toBe("Video comment");
  });

  test("morphTo resolves correct parent", async () => {
    const post = await MPost.create({ title: "Post 2" });
    const comment = await MComment.create({ body: "C2", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });

    const owner = await comment.commentable().getResults();
    expect(owner).not.toBeNull();
    expect(owner!).toBeInstanceOf(MPost);
    expect(owner!.getAttribute("title")).toBe("Post 2");
  });

  test("with eager loads morphTo relations across types", async () => {
    const post = await MPost.create({ title: "Eager Post" });
    const video = await MVideo.create({ title: "Eager Video" });
    await MComment.create({ body: "Post eager comment", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "Video eager comment", commentable_id: video.getAttribute("id"), commentable_type: "MVideo" });

    const comments = await MComment.with("commentable").whereIn("body", ["Post eager comment", "Video eager comment"]).orderBy("body").get();

    expect(comments).toHaveLength(2);
    expect(comments[0].getRelation("commentable")).toBeInstanceOf(MPost);
    expect(comments[0].getRelation("commentable").getAttribute("title")).toBe("Eager Post");
    expect(comments[1].getRelation("commentable")).toBeInstanceOf(MVideo);
    expect(comments[1].getRelation("commentable").getAttribute("title")).toBe("Eager Video");
  });

  test("morphOne returns single related model", async () => {
    const video = await MVideo.create({ title: "Video 2" });
    await MImage.create({ url: "thumb.jpg", imageable_id: video.getAttribute("id"), imageable_type: "MVideo" });

    const thumb = await video.thumbnail().getResults();
    expect(thumb).not.toBeNull();
    expect(thumb!.getAttribute("url")).toBe("thumb.jpg");
  });

  test("morphToMany / morphedByMany works", async () => {
    const post = await MPost.create({ title: "Tagged Post" });
    const tag = await MTag.create({ name: "Important" });

    await new Builder(connection, "taggables").insert({
      tag_id: tag.getAttribute("id"),
      taggable_id: post.getAttribute("id"),
      taggable_type: "MPost",
    });

    const posts = await tag.posts().getResults();
    expect(posts).toHaveLength(1);
    expect(posts[0].getAttribute("title")).toBe("Tagged Post");
  });

  test("whereAttachedTo filters morphToMany relations", async () => {
    const post = await MPost.create({ title: "Morph Attached Shortcut" });
    const other = await MPost.create({ title: "Other Morph Attached Shortcut" });
    const tag = await MTag.create({ name: "Morph Shortcut Tag" });
    const otherTag = await MTag.create({ name: "Other Morph Shortcut Tag" });

    await post.tags().attach(tag.getAttribute("id"));
    await other.tags().attach(otherTag.getAttribute("id"));

    const explicit = await MPost.whereAttachedTo("tags", tag).get();

    expect(explicit).toHaveLength(1);
    expect(explicit[0].getAttribute("title")).toBe("Morph Attached Shortcut");

    const relationFirst = await MTag.query().whereAttachedTo("posts", post).get();
    expect(relationFirst).toHaveLength(1);
    expect(relationFirst[0].getAttribute("name")).toBe("Morph Shortcut Tag");
  });

  test("whereAttachedTo supports morphToMany relation IntelliSense", () => {
    if (false) {
      MPost.whereAttachedTo("tags", new MTag());
      MPost.query().whereAttachedTo("importantTags", new MTag());

      // @ts-expect-error Relation-first calls require the related model as the second argument.
      MPost.whereAttachedTo("tags");
      // @ts-expect-error morphMany relations should not be suggested for whereAttachedTo.
      MPost.whereAttachedTo("comments", new MTag());
      // @ts-expect-error Empty strings should not be accepted as typed attachable relation names.
      MPost.query().whereAttachedTo("", new MTag());
    }
  });

  test("whereHasMorph and whereDoesntHaveMorph filter morphTo relations by type", async () => {
    await MComment.truncate();

    const post = await MPost.create({ title: "Morph target" });
    const video = await MVideo.create({ title: "Other target" });

    await MComment.create({ body: "post match", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "video row", commentable_id: video.getAttribute("id"), commentable_type: "MVideo" });

    const matched = await MComment.whereHasMorph("commentable", [MPost, MVideo], (query) => {
      query.where("title", "Morph target");
    }).get();

    expect(matched).toHaveLength(1);
    expect(matched[0].getAttribute("body")).toBe("post match");

    const excluded = await MComment.whereDoesntHaveMorph("commentable", [MPost], (query) => {
      query.where("title", "Morph target");
    }).get();

    expect(excluded).toHaveLength(1);
    expect(excluded[0].getAttribute("body")).toBe("video row");
  });

  test("whereMorphedTo family filters morphTo columns directly", async () => {
    await MComment.truncate();

    const post = await MPost.create({ title: "Direct morph post" });
    const otherPost = await MPost.create({ title: "Other direct morph post" });
    const video = await MVideo.create({ title: "Direct morph video" });

    await MComment.create({ body: "post exact", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "post other", commentable_id: otherPost.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "video exact", commentable_id: video.getAttribute("id"), commentable_type: "MVideo" });

    const exact = await MComment.whereMorphedTo("commentable", post).get();
    expect(exact.map((comment) => comment.getAttribute("body"))).toEqual(["post exact"]);

    const allPosts = await MComment.whereMorphedTo("commentable", MPost).orderBy("body").get();
    expect(allPosts.map((comment) => comment.getAttribute("body"))).toEqual(["post exact", "post other"]);

    const notExact = await MComment.whereNotMorphedTo("commentable", post).orderBy("body").get();
    expect(notExact.map((comment) => comment.getAttribute("body"))).toEqual(["post other", "video exact"]);

    const postOrVideo = await MComment.whereMorphedTo("commentable", post)
      .orWhereMorphedTo("commentable", video)
      .orderBy("body")
      .get();
    expect(postOrVideo.map((comment) => comment.getAttribute("body"))).toEqual(["post exact", "video exact"]);

    if (false) {
      MComment.whereMorphedTo("commentable", new MPost());
      MComment.whereNotMorphedTo("commentable", MPost);
      MComment.orWhereMorphedTo("commentable", "MVideo");
      // @ts-expect-error Only morphTo relation names should be accepted.
      MComment.whereMorphedTo("missing", new MPost());
      // @ts-expect-error Non-morph relations should not be suggested.
      MPost.whereMorphedTo("comments", new MPost());
    }
  });

  test("morphTo with morphWith and morphWithCount loads type-specific relations", async () => {
    await MComment.truncate();
    await MImage.truncate();

    const post = await MPost.create({ title: "Morph eager" });
    const video = await MVideo.create({ title: "Morph video" });

    await MImage.create({ url: "thumb.jpg", imageable_id: video.getAttribute("id"), imageable_type: "MVideo" });
    await MComment.create({ body: "post comment 1", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "post comment 2", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "video comment", commentable_id: video.getAttribute("id"), commentable_type: "MVideo" });

    const comments = await MComment.with({
      commentable: (relation) =>
        relation.morphWith({
          MPost: ["comments"],
          MVideo: ["thumbnail"],
        }).morphWithCount({
          MPost: ["comments"],
        }),
    }).orderBy("body").get();

    const postComment = comments.find((comment) => comment.getAttribute("body") === "post comment 1")!;
    const videoComment = comments.find((comment) => comment.getAttribute("body") === "video comment")!;

    const loadedPost = postComment.getRelation("commentable");
    expect(loadedPost).toBeInstanceOf(MPost);
    expect(loadedPost.getRelation("comments")).toBeInstanceOf(Array);
    expect(loadedPost.getRelation("comments")).toHaveLength(2);
    expect(loadedPost.getAttribute("comments_count")).toBe(2);

    const loadedVideo = videoComment.getRelation("commentable");
    expect(loadedVideo).toBeInstanceOf(MVideo);
    expect(loadedVideo.getRelation("thumbnail")).not.toBeNull();
    expect(loadedVideo.getRelation("thumbnail").getAttribute("url")).toBe("thumb.jpg");

    if (false) {
      const relation = postComment.getRelation("commentable");
      if (relation) {
        relation.morphWith({ MPost: ["comments"] });
        relation.morphWithCount({ MPost: ["comments"] });
      }
    }
  });

  test("loadMorph eager loads nested relations for morphTo collections", async () => {
    await MComment.truncate();
    await MImage.truncate();

    const post = await MPost.create({ title: "LoadMorph post" });
    const video = await MVideo.create({ title: "LoadMorph video" });

    await MImage.create({ url: "video-thumb.jpg", imageable_id: video.getAttribute("id"), imageable_type: "MVideo" });
    await MComment.create({ body: "load post comment", commentable_id: post.getAttribute("id"), commentable_type: "MPost" });
    await MComment.create({ body: "load video comment", commentable_id: video.getAttribute("id"), commentable_type: "MVideo" });

    const comments = await MComment.with("commentable").orderBy("body").get();
    await comments.loadMorph("commentable", {
      MPost: ["comments"],
      MVideo: ["thumbnail"],
    });

    const loadedPost = comments.find((comment) => comment.getAttribute("body") === "load post comment")!.getRelation("commentable");
    const loadedVideo = comments.find((comment) => comment.getAttribute("body") === "load video comment")!.getRelation("commentable");

    expect(loadedPost.getRelation("comments")).toHaveLength(1);
    expect(loadedVideo.getRelation("thumbnail")).not.toBeNull();
    expect(loadedVideo.getRelation("thumbnail").getAttribute("url")).toBe("video-thumb.jpg");
  });

  test("morphToMany create/save helpers fill constrained fields", async () => {
    const post = await MPost.create({ title: "Morph Helpers" });
    const relation = post.importantTags();

    const created = await relation.create({ name: "Wrong" }, { scope: "manual" });
    expect(created.getAttribute("name")).toBe("Important");

    const saved = await relation.save(await MTag.create({ name: "Manual" }), { scope: "manual" });
    expect(saved.getAttribute("name")).toBe("Important");

    const tags = await relation.getResults();
    expect(tags).toHaveLength(2);
    expect(tags[0].getAttribute("name")).toBe("Important");
    expect(tags[0].pivot.scope).toBe("important");
    expect(tags[1].getAttribute("name")).toBe("Important");
    expect(tags[1].pivot.scope).toBe("important");

    if (false) {
      // @ts-expect-error name is fixed by the relation constraint and should not be suggested.
      relation.create({ name: "Manual" });
    }
  });

  test("morph eager-load callbacks expose IntelliSense for the expected relation shape", async () => {
    if (false) {
      const comments = [] as unknown as Collection<MComment>;

      MComment.with({
        commentable: (relation) => {
          relation.morphWith({
            MPost: ["comments"],
            MVideo: ["thumbnail"],
          });
          relation.morphWithCount({
            MPost: ["comments"],
          });
          // @ts-expect-error pivot helpers are not part of MorphTo IntelliSense.
          relation.wherePivot("scope", "important");
        },
      });

      MComment.whereHasMorph("commentable", [MPost, MVideo], (query) => {
        query.where("title", "Morph target");
        // @ts-expect-error morphWith belongs on MorphTo eager-load callbacks, not morph query filters.
        query.morphWith({ MPost: ["comments"] });
      });

      await comments.loadMorph("commentable", {
        MPost: ["comments"],
        MVideo: ["thumbnail"],
      });

      const loadedComments = await MComment.with("commentable").get();
      await loadedComments.loadMorph("commentable", {
        MPost: ["comments"],
        MVideo: ["thumbnail"],
      });

      const loadedComment = (await MComment.with("commentable").first())!;
      await loadedComment.loadMorph("commentable", {
        MPost: ["comments"],
      });

      const student = (await MStudent.first())!;
      const loadedStudent = await student.load("attachments", "profilePicture");
      loadedStudent.attachments.first();
      loadedStudent.profilePicture?.getAttribute("filename");
      const directLoadedStudent = await student.load("attachments");
      directLoadedStudent.attachments.first();

      const students = [] as unknown as Collection<MStudent>;
      await students.loadMissing("attachments", "profilePicture");
      await students.loadMissing("attachments");
      // @ts-expect-error Empty strings should not be accepted as typed relation names.
      await student.load("");
      // @ts-expect-error Unknown relation names should not be suggested.
      await student.load("missingRelation");
    }
  });

  test("morphToMany createMany/saveMany helpers fill constrained fields", async () => {
    const post = await MPost.create({ title: "Morph Bulk Helpers" });

    const created = await post.importantTags().createMany([{ name: "Wrong 1" }, { name: "Wrong 2" }], { scope: "manual" });
    expect(created).toHaveLength(2);
    expect(created.every((tag) => tag.getAttribute("name") === "Important")).toBe(true);

    const saved = await post.importantTags().saveMany([await MTag.create({ name: "Wrong 3" }), await MTag.create({ name: "Wrong 4" })], {
      scope: "manual",
    });
    expect(saved).toHaveLength(2);
    expect(saved.every((tag) => tag.getAttribute("name") === "Important")).toBe(true);

    const tags = await post.importantTags().getResults();
    expect(tags).toHaveLength(4);
    expect(tags.every((tag) => tag.pivot.scope === "important")).toBe(true);
  });

  test("extended pivot helpers work on morphToMany relations", async () => {
    const post = await MPost.create({ title: "Morph Pivot Helpers" });
    const tag1 = await MTag.create({ name: "Important" });
    const tag2 = await MTag.create({ name: "Important" });
    const tag3 = await MTag.create({ name: "Other" });

    await post.tags().attach(tag1.getAttribute("id"), { priority: 1, scope: "primary" });
    await post.tags().attach(tag2.getAttribute("id"), { priority: 3, scope: "secondary" });
    await post.tags().withPivotValue("priority", 5).attach(tag3.getAttribute("id"), { scope: "generated" });

    const between = await post.tags().wherePivotBetween("priority", [2, 5]).getResults();
    expect(between).toHaveLength(2);

    const notIn = await post.tags().wherePivotNotIn("priority", [1]).wherePivotNotNull("priority").getResults();
    expect(notIn).toHaveLength(2);

    const defaulted = await post.tags().withPivotValue("priority", 5).getResults();
    expect(defaulted).toHaveLength(1);
    expect(defaulted[0].getAttribute("name")).toBe("Other");

    if (false) {
      post.tags()
        .wherePivotBetween("priority", [1, 5])
        .wherePivotNotIn("priority", [2])
        .wherePivotNotNull("priority")
        .orWherePivotIn("priority", [3])
        .orWherePivotNull("priority")
        .withPivotValue("priority", 5);
    }
  });

  test("morphMany attach() and attachMany() set morph columns automatically", async () => {
    const student = await MStudent.create({ name: "Ada" });

    const one = await student.attachments().attach({ filename: "transcript.pdf", attachable_type: "Other", attachable_id: 999 });
    expect(one.getAttribute("attachable_id")).toBe(student.getAttribute("id"));
    expect(one.getAttribute("attachable_type")).toBe("MStudent");

    const many = await student.attachments().attachMany([
      { filename: "photo-1.jpg", attachable_type: "Other" },
      { filename: "photo-2.jpg", attachable_id: 321 },
    ]);
    expect(many).toHaveLength(2);
    expect(many.every((item) => item.getAttribute("attachable_type") === "MStudent")).toBe(true);
  });

  test("morphOne attach() applies the fixed constraint and omits it from input typing", async () => {
    const student = await MStudent.create({ name: "Bea" });

    const picture = await student.profilePicture().attach({ filename: "profile.jpg", collection: "manual" });
    expect(picture.getAttribute("collection")).toBe("profile_picture");
    expect(picture.getAttribute("attachable_id")).toBe(student.getAttribute("id"));

    const relation = student.profilePicture();
    if (false) {
      // @ts-expect-error attachable_id is injected by the relation and should not be suggested.
      relation.attach({ attachable_id: 1 });
      // @ts-expect-error collection is fixed by the relation constraint and should not be suggested.
      relation.attach({ collection: "profile_picture" });
    }
  });

  test("morphToMany existence queries qualify pivot table with PostgreSQL schema", () => {
    class SchemaPost extends Model {
      static table = "schema_posts";
      tags() {
        return this.morphToMany(SchemaTag, "taggable");
      }
    }
    class SchemaTag extends Model {
      static table = "schema_tags";
    }

    const connection = new Connection({ url: "postgres://user:pass@localhost:5432/db", schema: "tenant_demo" });
    (SchemaPost as any).connection = connection;

    const sql = SchemaPost.withExists("tags", "has_tags").toSql();

    expect(sql).toContain('INNER JOIN "tenant_demo"."taggables"');
  });
});
