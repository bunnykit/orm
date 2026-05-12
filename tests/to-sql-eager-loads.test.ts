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

// ─── Type-level test: nested constraint map preserves loaded relation types ───

describe("nested constraint map typed loading", () => {
  test("gradingPeriods type is Collection<GradingPeriod> not method", () => {
    class GPeriod extends Model { static table = "g_periods"; }
    class Sem extends Model {
      static table = "sems";
      gradingPeriods() { return this.hasMany(GPeriod); }
    }
    class AcalYear extends Model {
      static table = "acal_years";
      semesters() { return this.hasMany(Sem); }
    }

    const builder = AcalYear.with({
      semesters: (q) => q.with({
        gradingPeriods: (q2) => q2.where("active", true),
      }),
    });

    // Runtime: builder is a Builder — type check is the goal
    // TypeScript: builder result type should have semesters as Collection<...>
    // and each semester's gradingPeriods as Collection<GPeriod>
    type Result = Awaited<ReturnType<typeof builder.find>>;
    type Semesters = NonNullable<Result>["semesters"];
    type GradingPeriodsOnSem = Semesters extends Collection<infer Elem>
      ? Elem extends { gradingPeriods: infer GP } ? GP : never
      : never;

    // If types are correct, GradingPeriodsOnSem should be Collection<GPeriod>
    // This is a compile-time assertion — if it fails, tsc fails
    const _assert: GradingPeriodsOnSem extends Collection<GPeriod> ? true : false = true;
    expect(_assert).toBe(true);
  });
});

describe("string relation type narrowing still works", () => {
  test("with('subjects') still narrows to Collection<Subject>", () => {
    class Subject2 extends Model { static table = "subjects2"; }
    class Curriculum2 extends Model {
      static table = "curricula2";
      subjects() { return this.hasMany(Subject2); }
    }

    const builder = Curriculum2.with("subjects");

    type Result = Awaited<ReturnType<typeof builder.find>>;
    type SubjectsType = NonNullable<Result>["subjects"];

    const _assert: SubjectsType extends Collection<Subject2> ? true : false = true;
    expect(_assert).toBe(true);
  });
});

describe("string with() produces exact loaded type (no deferred union)", () => {
  test("with('program') gives Program | null, not method | Program | null", () => {
    class Prog extends Model { static table = "progs"; }
    class Cur extends Model {
      static table = "curs";
      program() { return this.belongsTo(Prog); }
    }

    const builder = Cur.with("program");

    // The loaded type for program must be exactly Prog | null
    type Result = Awaited<ReturnType<typeof builder.first>>;
    type ProgramType = NonNullable<Result>["program"];

    // If this compiles, ProgramType is assignable to Prog | null (not a union with the method)
    const _assert: ProgramType extends Prog | null ? true : false = true;
    // And the method type must NOT bleed in — function should not be assignable to Prog | null
    const _assertNoMethod: (() => any) extends ProgramType ? false : true = true;
    expect(_assert).toBe(true);
    expect(_assertNoMethod).toBe(true);
  });
});
