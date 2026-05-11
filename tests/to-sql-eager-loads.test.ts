import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class ECurriculum extends Model {
  static table = "eager_curricula";
  program() {
    return this.belongsTo(EProgram);
  }
  subjects() {
    return this.belongsToMany(ESubject, "eager_curriculum_subjects").withPivot(["year_level", "term"]).withTimestamps();
  }
}

class EProgram extends Model {
  static table = "eager_programs";
  curricula() {
    return this.hasMany(ECurriculum);
  }
}

class ESubject extends Model {
  static table = "eager_subjects";
  static curricula() {
    return this.belongsToMany(ECurriculum, "eager_curriculum_subjects");
  }
}

describe("toSqlWithEagerLoads", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("eager_curricula", (table) => {
      table.increments("id");
      table.string("name");
      table.integer("program_id").unsigned().nullable();
      table.timestamps();
    });
    await Schema.create("eager_programs", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("eager_subjects", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("eager_curriculum_subjects", (table) => {
      table.increments("id");
      table.integer("curriculum_id");
      table.integer("subject_id");
      table.integer("year_level");
      table.integer("term");
      table.timestamps();
    });
  });

  test("toSqlWithEagerLoads returns main query only when no eager loads", () => {
    const sql = ECurriculum.query().toSqlWithEagerLoads([]);
    expect(sql).toContain('SELECT * FROM "eager_curricula"');
  });

  test("toSqlWithEagerLoads returns main query and relation queries", async () => {
    const curriculum = await ECurriculum.create({ name: "Test Curriculum" });
    const sql = ECurriculum.with("program", "subjects").toSqlWithEagerLoads([curriculum]);
    const queries = sql.split(";\n");
    expect(queries.length).toBe(3);
    expect(queries[0]).toContain('SELECT * FROM "eager_curricula"');
    expect(queries[1]).toContain('FROM "eager_programs"');
    expect(queries[2]).toContain('FROM "eager_subjects"');
    expect(queries[2]).toContain("year_level");
    expect(queries[2]).toContain("term");
    expect(queries[2]).toContain("created_at");
    expect(queries[2]).toContain("updated_at");
  });

  test("toSqlWithEagerLoads includes orderBy from main query", async () => {
    const curriculum = await ECurriculum.create({ name: "Test" });
    const sql = ECurriculum.with("program").orderBy("created_at", "desc").toSqlWithEagerLoads([curriculum]);
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("created_at");
  });
});
