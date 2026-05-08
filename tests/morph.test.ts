import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, MorphMap, Builder } from "../src/index.js";
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
});
