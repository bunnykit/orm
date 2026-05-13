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

describe("model json type", () => {
  test("json() includes Model.define attributes", () => {
    interface SectionAttrs {
      id: number;
      name: string;
      year_level: number;
    }

    class Section extends Model.define<SectionAttrs>("typed_json_sections") {}

    const section = new Section({ id: 1, name: "A", year_level: 2 });
    const json = section.json();

    const _id: number = json.id;
    const _name: string = json.name;
    const _yearLevel: number = json.year_level;

    expect(_id).toBe(1);
    expect(_name).toBe("A");
    expect(_yearLevel).toBe(2);
  });

  test("json() includes loaded relation shapes", () => {
    interface AdviserAttrs {
      id: number;
      name: string;
    }
    interface SubjectAttrs {
      id: number;
      title: string;
    }
    interface SectionAttrs {
      id: number;
      adviser_id: number | null;
      name: string;
    }

    class Adviser extends Model.define<AdviserAttrs>("typed_json_advisers") {}
    class Subject extends Model.define<SubjectAttrs>("typed_json_subjects") {}
    class Section extends Model.define<SectionAttrs>("typed_json_sections") {
      adviser() { return this.belongsTo(Adviser); }
      subjects() { return this.hasMany(Subject); }
    }

    const builder = Section.with("adviser", "subjects");

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;
    type AdviserJson = Json["adviser"];
    type SubjectsJson = Json["subjects"];

    const _hasAdviserKey: "adviser" extends keyof Json ? true : false = true;
    const _hasSubjectsKey: "subjects" extends keyof Json ? true : false = true;
    const _adviserName: NonNullable<AdviserJson>["name"] extends string ? true : false = true;
    const _subjectsAreArray: SubjectsJson extends Array<any> ? true : false = true;
    const _subjectTitle: SubjectsJson[number]["title"] extends string ? true : false = true;

    expect(_hasAdviserKey).toBe(true);
    expect(_hasSubjectsKey).toBe(true);
    expect(_adviserName).toBe(true);
    expect(_subjectsAreArray).toBe(true);
    expect(_subjectTitle).toBe(true);
  });

  test("json() keeps loaded relation shapes through chained array with()", () => {
    interface AdviserAttrs {
      id: number;
      name: string;
    }
    interface BranchAttrs {
      id: number;
      name: string;
    }
    interface SectionAttrs {
      id: number;
      adviser_id: number | null;
      branch_id: number | null;
      name: string;
    }

    class Adviser extends Model.define<AdviserAttrs>("typed_json_chain_advisers") {}
    class Branch extends Model.define<BranchAttrs>("typed_json_chain_branches") {}
    class Section extends Model.define<SectionAttrs>("typed_json_chain_sections") {
      adviser() { return this.belongsTo(Adviser); }
      branch() { return this.belongsTo(Branch); }
    }

    const builder = Section
      .with("adviser")
      .with(["branch"]);

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;

    const _hasAdviserKey: "adviser" extends keyof Json ? true : false = true;
    const _hasBranchKey: "branch" extends keyof Json ? true : false = true;
    const _adviserName: NonNullable<Json["adviser"]>["name"] extends string ? true : false = true;
    const _branchName: NonNullable<Json["branch"]>["name"] extends string ? true : false = true;

    expect(_hasAdviserKey).toBe(true);
    expect(_hasBranchKey).toBe(true);
    expect(_adviserName).toBe(true);
    expect(_branchName).toBe(true);
  });

  test("json() includes withCount result keys", () => {
    interface AdmissionAttrs {
      id: number;
      section_id: number;
    }
    interface SectionAttrs {
      id: number;
      name: string;
    }

    class Admission extends Model.define<AdmissionAttrs>("typed_json_count_admissions") {}
    class Section extends Model.define<SectionAttrs>("typed_json_count_sections") {
      admissions() { return this.hasMany(Admission); }
    }

    const builder = Section
      .withCount("admissions")
      .withCount("admissions", "total_admissions");
    const staticAutocompleteBuilder = Section.withCount("admissions");
    const queryAutocompleteBuilder = Section.query().withCount("admissions");

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;
    type StaticAutocompleteResult = NonNullable<Awaited<ReturnType<typeof staticAutocompleteBuilder.find>>>;
    type QueryAutocompleteResult = NonNullable<Awaited<ReturnType<typeof queryAutocompleteBuilder.find>>>;

    const _hasDefaultCount: "admissions_count" extends keyof Json ? true : false = true;
    const _hasAliasCount: "total_admissions" extends keyof Json ? true : false = true;
    const _defaultCount: Json["admissions_count"] extends number ? true : false = true;
    const _aliasCount: Json["total_admissions"] extends number ? true : false = true;
    const _staticAutocompleteCount: ReturnType<StaticAutocompleteResult["json"]>["admissions_count"] extends number ? true : false = true;
    const _queryAutocompleteCount: ReturnType<QueryAutocompleteResult["json"]>["admissions_count"] extends number ? true : false = true;
    // @ts-expect-error Unknown keys should not be admitted by a broad Record<string, any>.
    type MissingCount = Json["missing_count"];

    expect(_hasDefaultCount).toBe(true);
    expect(_hasAliasCount).toBe(true);
    expect(_defaultCount).toBe(true);
    expect(_aliasCount).toBe(true);
    expect(_staticAutocompleteCount).toBe(true);
    expect(_queryAutocompleteCount).toBe(true);
  });

  test("relation aggregates infer related model columns", () => {
    interface AdmissionAttrs {
      id: number;
      section_id: number;
      score: number;
      status: string;
    }
    interface SectionAttrs {
      id: number;
      year_level: number;
    }

    class Admission extends Model.define<AdmissionAttrs>("typed_json_aggregate_admissions") {}
    class Section extends Model.define<SectionAttrs>("typed_json_aggregate_sections") {
      admissions() { return this.hasMany(Admission); }
    }

    const sumBuilder = Section.withSum("admissions", "id");
    const avgBuilder = Section.withAvg("admissions", "score", (query) => query.where("status", "enrolled"));
    const minBuilder = Section.withMin("admissions", "score", "minimum_score");
    const maxBuilder = Section.withMax("admissions", "score", "maximum_score", (query) => query.where("status", "enrolled"));
    const builderAvg = Section.query().withAvg("admissions", "score", (query) => query.where("status", "enrolled"));
    const builderMax = Section.query().withMax("admissions", "score", "maximum_score", (query) => query.where("status", "enrolled"));

    // @ts-expect-error Related aggregate columns should come from Admission, not Section.
    Section.withSum("admissions", "year_level");
    // @ts-expect-error Related aggregate columns should come from Admission, not Section.
    Section.query().withAvg("admissions", "year_level");

    expect(sumBuilder).toBeDefined();
    expect(avgBuilder).toBeDefined();
    expect(minBuilder).toBeDefined();
    expect(maxBuilder).toBeDefined();
    expect(builderAvg.toSql()).toContain("\"status\" = 'enrolled'");
    expect(builderMax.toSql()).toContain("\"status\" = 'enrolled'");
  });
});
