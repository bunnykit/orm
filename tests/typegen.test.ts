import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { Schema, TypeGenerator, discoverModelTables } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

const OUT_DIR = join(process.cwd(), "tests", "temp_types");
const DECL_OUT_DIR = join(process.cwd(), "tests", "temp_type_declarations");
const MODEL_ROOT_A = join(process.cwd(), "tests", "temp_models_a");
const MODEL_ROOT_B = join(process.cwd(), "tests", "temp_models_b");
const MODEL_DISCOVERY_DIR = join(process.cwd(), "tests", "temp_model_discovery");
const MODEL_LOWERCASE_DIR = join(process.cwd(), "tests", "temp_model_lowercase");

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
    for (const dir of [OUT_DIR, DECL_OUT_DIR, MODEL_ROOT_A, MODEL_ROOT_B, MODEL_DISCOVERY_DIR, MODEL_LOWERCASE_DIR]) {
      await rm(dir, { recursive: true, force: true });
    }
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
    expect(files).toContain("users.ts");
    expect(files).toContain("index.ts");

    const content = await Bun.file(join(DECL_OUT_DIR, "users.ts")).text();
    expect(content).toContain("export interface UsersAttributes {");
    expect(content).not.toContain("extends Model");
    expect(content).toContain('declare module "../models/User" {');
    expect(content).toContain("interface User extends UsersAttributes {}");
    expect(content).toContain("name: string;");
  });

  test("generates convention-based declaration mappings", async () => {
    const conventionDir = join(process.cwd(), "tests", "temp_convention_types");
    const generator = new TypeGenerator(connection, {
      outDir: conventionDir,
      declarations: true,
      modelImportPrefix: "../models",
    });
    await generator.generate();

    const userContent = await Bun.file(join(conventionDir, "users.ts")).text();
    expect(userContent).toContain('declare module "../models/User" {');
    expect(userContent).toContain("interface User extends UsersAttributes {}");
    expect(userContent).toContain("name: string;");

    const postContent = await Bun.file(join(conventionDir, "blog_posts.ts")).text();
    expect(postContent).toContain('declare module "../models/BlogPost" {');
    expect(postContent).toContain("interface BlogPost extends BlogPostsAttributes {}");
    expect(postContent).toContain("title: string;");

    await rm(conventionDir, { recursive: true, force: true });
  });

  test("generates declarations into a types folder beside each model root", async () => {
    await Schema.create("team_members", (table) => {
      table.increments("id");
      table.string("name");
    });

    const generator = new TypeGenerator(connection, {
      outDir: join(MODEL_ROOT_A, "types"),
      declarations: true,
      modelDirectories: [MODEL_ROOT_A, MODEL_ROOT_B],
    });
    await generator.generate();

    const filesA = await readdir(join(MODEL_ROOT_A, "types"));
    const filesB = await readdir(join(MODEL_ROOT_B, "types"));
    expect(filesA).toContain("team_members.ts");
    expect(filesB).toContain("team_members.ts");

    const content = await Bun.file(join(MODEL_ROOT_A, "types", "team_members.ts")).text();
    expect(content).toContain('declare module "../TeamMember" {');
  });

  test("allowedTables filters generated types to only matching tables", async () => {
    const filteredDir = join(process.cwd(), "tests", "temp_filtered_types");
    const generator = new TypeGenerator(connection, {
      outDir: filteredDir,
      stubs: true,
      allowedTables: ["users"],
    });
    await generator.generate();

    const files = await readdir(filteredDir);
    expect(files).toContain("users.ts");
    expect(files).toContain("index.ts");
    expect(files).not.toContain("blog_posts.ts");
    expect(files).not.toContain("team_members.ts");

    const indexContent = await Bun.file(join(filteredDir, "index.ts")).text();
    expect(indexContent).toContain("users");
    expect(indexContent).not.toContain("blog_posts");
    expect(indexContent).not.toContain("team_members");

    await rm(filteredDir, { recursive: true, force: true });
  });

  test("discoverModelTables extracts table names from model files", async () => {
    await mkdir(MODEL_DISCOVERY_DIR, { recursive: true });

    await Bun.write(
      join(MODEL_DISCOVERY_DIR, "User.ts"),
      `import { Model } from "../../src/index.js";\nexport class User extends Model {\n  static table = "custom_users";\n}\n`
    );
    await Bun.write(
      join(MODEL_DISCOVERY_DIR, "Post.ts"),
      `import { Model } from "../../src/index.js";\nexport class Post extends Model {}\n`
    );
    await Bun.write(
      join(MODEL_DISCOVERY_DIR, "Comment.ts"),
      `import { Model } from "../../src/index.js";\nexport default class Comment extends Model {\n  static table = "comments";\n}\n`
    );
    await Bun.write(
      join(MODEL_DISCOVERY_DIR, "helper.ts"),
      `export function helper() { return 1; }\n`
    );

    const tables = await discoverModelTables([MODEL_DISCOVERY_DIR]);
    expect(tables).toContain("custom_users");
    expect(tables).toContain("posts");
    expect(tables).toContain("comments");
    expect(tables).not.toContain("helpers");
  });

  test("uses actual model file path in declare module when model file exists", async () => {
    await Schema.create("tenants", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });

    await mkdir(MODEL_LOWERCASE_DIR, { recursive: true });
    await Bun.write(
      join(MODEL_LOWERCASE_DIR, "tenant.ts"),
      `import { Model } from "../../src/index.js";\nexport default class Tenant extends Model {\n  static table = "tenants";\n}\n`
    );

    const generator = new TypeGenerator(connection, {
      outDir: join(MODEL_LOWERCASE_DIR, "types"),
      declarations: true,
      modelDirectories: [MODEL_LOWERCASE_DIR],
    });
    await generator.generate();

    const content = await Bun.file(join(MODEL_LOWERCASE_DIR, "types", "tenants.ts")).text();
    expect(content).toContain('import { Tenant } from "../tenant"');
    expect(content).toContain('declare module "../tenant" {');
    expect(content).toContain("interface Tenant extends TenantsAttributes {}");
    expect(content).toContain("name: string;");
    expect(content).not.toContain('declare module "../Tenant" {');
  });

  test("uses alias prefix with subdirectory path for discovered models", async () => {
    const aliasDir = join(process.cwd(), "tests", "temp_alias_types");
    const modelRoot = join(process.cwd(), "tests", "temp_alias_models");
    await mkdir(join(modelRoot, "landlord"), { recursive: true });

    await Bun.write(
      join(modelRoot, "landlord", "tenant.ts"),
      `import { Model } from "../../../src/index.js";\nexport class Tenant extends Model {\n  static table = "tenants";\n}\n`
    );

    const generator = new TypeGenerator(connection, {
      outDir: join(modelRoot, "types"),
      declarations: true,
      modelDirectories: [modelRoot],
      modelImportPrefix: "$models",
    });
    await generator.generate();

    const content = await Bun.file(join(modelRoot, "types", "tenants.ts")).text();
    expect(content).toContain('import { Tenant } from "$models/landlord/tenant"');
    expect(content).toContain('declare module "$models/landlord/tenant" {');
    expect(content).toContain("interface Tenant extends TenantsAttributes {}");

    await rm(aliasDir, { recursive: true, force: true });
    await rm(modelRoot, { recursive: true, force: true });
  });

  test("generate returns the list of generated tables", async () => {
    const returnDir = join(process.cwd(), "tests", "temp_return_types");
    const generator = new TypeGenerator(connection, {
      outDir: returnDir,
      declarations: true,
      allowedTables: ["users"],
    });
    const tables = await generator.generate();
    expect(tables).toContain("users");
    expect(tables).not.toContain("blog_posts");
    await rm(returnDir, { recursive: true, force: true });
  });

  test("skipIndex prevents writing the index file", async () => {
    const skipDir = join(process.cwd(), "tests", "temp_skip_index");
    const generator = new TypeGenerator(connection, {
      outDir: skipDir,
      declarations: true,
      allowedTables: ["users"],
      skipIndex: true,
    });
    await generator.generate();
    const files = await readdir(skipDir);
    expect(files).toContain("users.ts");
    expect(files).not.toContain("index.ts");
    await rm(skipDir, { recursive: true, force: true });
  });

  test("generates combined types from separate model roots with skipIndex", async () => {
    const combinedDir = join(process.cwd(), "tests", "temp_combined_types");
    await mkdir(combinedDir, { recursive: true });

    // Generate landlord-like tables (users, blog_posts already exist)
    const landlordGenerator = new TypeGenerator(connection, {
      outDir: combinedDir,
      declarations: true,
      allowedTables: ["users"],
      skipIndex: true,
    });
    const landlordTables = await landlordGenerator.generate();

    // Generate tenant-like tables (team_members already exists)
    const tenantGenerator = new TypeGenerator(connection, {
      outDir: combinedDir,
      declarations: true,
      allowedTables: ["team_members"],
      skipIndex: true,
    });
    const tenantTables = await tenantGenerator.generate();

    // Verify both files exist
    const files = await readdir(combinedDir);
    expect(files).toContain("users.ts");
    expect(files).toContain("team_members.ts");
    expect(files).not.toContain("index.ts");

    // Write combined index
    const allTables = [...new Set([...landlordTables, ...tenantTables])];
    const indexLines = allTables.map((table) => {
      const className = table
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("");
      return `export * from "./${className.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "")}";`;
    });
    await writeFile(join(combinedDir, "index.ts"), indexLines.join("\n") + "\n", "utf-8");

    const indexContent = await Bun.file(join(combinedDir, "index.ts")).text();
    expect(indexContent).toContain("users");
    expect(indexContent).toContain("team_members");

    await rm(combinedDir, { recursive: true, force: true });
  });
});
