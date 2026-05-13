import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, MorphMap, Builder, Connection } from "../src/index.js";
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

  test("morphMany attach() and attachMany() set morph columns automatically", async () => {
    const student = await MStudent.create({ name: "Ada" });

    const one = await student.attachments().attach({ filename: "transcript.pdf" });
    expect(one.getAttribute("attachable_id")).toBe(student.getAttribute("id"));
    expect(one.getAttribute("attachable_type")).toBe("MStudent");

    const many = await student.attachments().attachMany([
      { filename: "photo-1.jpg" },
      { filename: "photo-2.jpg" },
    ]);
    expect(many).toHaveLength(2);
    expect(many.every((item) => item.getAttribute("attachable_type") === "MStudent")).toBe(true);
  });

  test("morphOne attach() applies the fixed constraint and omits it from input typing", async () => {
    const student = await MStudent.create({ name: "Bea" });

    const picture = await student.profilePicture().attach({ filename: "profile.jpg" });
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
