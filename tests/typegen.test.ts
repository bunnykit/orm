import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { readdir, rmdir, unlink } from "fs/promises";
import { join } from "path";
import { Schema, TypeGenerator } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

const OUT_DIR = join(process.cwd(), "tests", "temp_types");
const DECL_OUT_DIR = join(process.cwd(), "tests", "temp_type_declarations");

describe("TypeGenerator", () => {
  let connection: ReturnType<typeof setupTestDb>;

  beforeAll(async () => {
    connection = setupTestDb();
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").nullable();
      table.boolean("active").default(true);
      table.integer("login_count").default(0);
      table.json("metadata").nullable();
      table.timestamps();
    });
    await Schema.create("blog_posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
  });

  afterAll(async () => {
    try {
      for (const dir of [OUT_DIR, DECL_OUT_DIR]) {
        const files = await readdir(dir);
        for (const f of files) {
          await unlink(join(dir, f));
        }
        await rmdir(dir);
      }
    } catch {}
  });

  test("generates interfaces and stubs from database schema", async () => {
    const generator = new TypeGenerator(connection, { outDir: OUT_DIR, stubs: true });
    await generator.generate();

    const files = await readdir(OUT_DIR);
    expect(files).toContain("users.ts");
    expect(files).toContain("index.ts");

    const content = await Bun.file(join(OUT_DIR, "users.ts")).text();
    expect(content).toContain("export interface UsersAttributes {");
    expect(content).toContain("id: number;");
    expect(content).toContain("name: string;");
    expect(content).toContain("email?: string | null;");
    // SQLite stores boolean as INTEGER
    expect(content).toContain("active: number;");
    expect(content).toContain("login_count: number;");
    // SQLite stores JSON as TEXT
    expect(content).toContain("metadata?: string | null;");
    expect(content).toContain("created_at?: string | null;");
    expect(content).toContain("updated_at?: string | null;");

    // Stubs
    expect(content).toContain("export class UsersBase extends Model<UsersAttributes> {");
    expect(content).toContain('static table = "users";');
    expect(content).toContain("get id(): number {");
    expect(content).toContain("set id(value: number) {");
  });

  test("generates declaration files that augment existing models", async () => {
    const generator = new TypeGenerator(connection, {
      outDir: DECL_OUT_DIR,
      declarations: true,
      modelDeclarations: {
        users: {
          path: "../models/User",
          className: "User",
        },
      },
    });
    await generator.generate();

    const files = await readdir(DECL_OUT_DIR);
    expect(files).toContain("users.d.ts");
    expect(files).toContain("index.d.ts");

    const content = await Bun.file(join(DECL_OUT_DIR, "users.d.ts")).text();
    expect(content).toContain("export interface UsersAttributes {");
    expect(content).not.toContain("extends Model");
    expect(content).toContain('declare module "../models/User" {');
    expect(content).toContain("interface User extends UsersAttributes {}");
  });

  test("generates convention-based declaration mappings", async () => {
    const conventionDir = join(process.cwd(), "tests", "temp_convention_types");
    const generator = new TypeGenerator(connection, {
      outDir: conventionDir,
      declarations: true,
      modelImportPrefix: "../models",
    });
    await generator.generate();

    const userContent = await Bun.file(join(conventionDir, "users.d.ts")).text();
    expect(userContent).toContain('declare module "../models/User" {');
    expect(userContent).toContain("interface User extends UsersAttributes {}");

    const postContent = await Bun.file(join(conventionDir, "blog_posts.d.ts")).text();
    expect(postContent).toContain('declare module "../models/BlogPost" {');
    expect(postContent).toContain("interface BlogPost extends BlogPostsAttributes {}");

    const files = await readdir(conventionDir);
    for (const f of files) {
      await unlink(join(conventionDir, f));
    }
    await rmdir(conventionDir);
  });
});
