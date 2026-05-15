import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, type AccessorMap } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

interface ProgramAttrs {
  id: number;
  name: string;
  level_id: number;
}

interface LevelAttrs {
  id: number;
  year_label: string;
  year_offset: number;
}

interface StaffAttrs {
  id: number;
  first_name: string;
  last_name: string;
}

interface SectionAttrs {
  id: number;
  year_level: number;
  program_id: number;
  adviser_id: number;
}

class Level extends Model.define<LevelAttrs>("ta_levels") {}

class Program extends Model.define<ProgramAttrs>("ta_programs") {
  level() {
    return this.belongsTo(Level, "level_id");
  }
}

class Staff extends Model.define<StaffAttrs>("ta_staff") {
  declare full_name: string;

  static accessors: AccessorMap<StaffAttrs, Staff> = {
    full_name: {
      get: (_value, attributes, model) => {
        const _typecheck: Staff = model;
        return `${attributes.first_name} ${attributes.last_name}`;
      },
    },
  };
}

class Section extends Model.define<SectionAttrs>("ta_sections") {
  declare grade_label: string;
  declare adviser_name: string;

  program() {
    return this.belongsTo(Program, "program_id");
  }

  adviser() {
    return this.belongsTo(Staff, "adviser_id");
  }

  static accessors: AccessorMap<SectionAttrs, Section> = {
    grade_label: {
      get: (_value, attributes, model) => {
        const program = model.getRelation("program") as Program | null;
        if (!program) return `Year ${attributes.year_level}`;
        const level = program.getRelation("level") as Level | null;
        if (!level) return `Year ${attributes.year_level}`;
        return `${level.year_label} ${level.year_offset + attributes.year_level}`;
      },
    },
    adviser_name: {
      get: (_value, attributes, model) => {
        const adviser = model.getRelation("adviser") as Staff | null;
        if (!adviser) return "Unassigned";
        return adviser.full_name;
      },
    },
  };
}

describe("Typed AccessorMap<TAttributes, TModel>", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("ta_levels", (table) => {
      table.increments("id");
      table.string("year_label");
      table.integer("year_offset");
      table.timestamps();
    });
    await Schema.create("ta_programs", (table) => {
      table.increments("id");
      table.string("name");
      table.integer("level_id");
      table.timestamps();
    });
    await Schema.create("ta_staff", (table) => {
      table.increments("id");
      table.string("first_name");
      table.string("last_name");
      table.timestamps();
    });
    await Schema.create("ta_sections", (table) => {
      table.increments("id");
      table.integer("year_level");
      table.integer("program_id");
      table.integer("adviser_id");
      table.timestamps();
    });

    const level = await Level.create({ year_label: "Grade", year_offset: 6 });
    const program = await Program.create({ name: "JHS", level_id: level.id });
    const staff = await Staff.create({ first_name: "Jane", last_name: "Doe" });
    await Section.create({
      year_level: 1,
      program_id: program.id,
      adviser_id: staff.id,
    });
  });

  test("accessor uses typed attributes + model relations", async () => {
    const section = await Section.query().with("program.level", "adviser").first();
    expect(section).not.toBeNull();
    expect(section!.grade_label).toBe("Grade 7");
    expect(section!.adviser_name).toBe("Jane Doe");
  });

  test("accessor falls back when relation not loaded", async () => {
    const section = await Section.query().first();
    expect(section!.grade_label).toBe("Year 1");
    expect(section!.adviser_name).toBe("Unassigned");
  });

  test("Staff accessor sees typed model", async () => {
    const staff = await Staff.query().first();
    expect(staff!.full_name).toBe("Jane Doe");
  });
});
