import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema, type RelationConstraintQuery } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

enum PAdmissionStatus {
  ENROLLED = "enrolled",
}

class PUser extends Model {
  static table = "p_users";
}

interface PSubjectAttrs {
  id: number;
  title: string;
  parent_id: number | null;
}

class PSubject extends Model.define<PSubjectAttrs>("p_subjects") {
  offerings() {
    return this.hasMany(POffering, "subject_id");
  }

  admissions() {
    return this.hasMany(PAdmission, "subject_id");
  }
}

class POffering extends Model.define<{ id: number; subject_id: number }>("p_offerings") {
  admissions() {
    return this.hasMany(PAdmission, "offering_id");
  }
}

class PAdmission extends Model.define<{ id: number; offering_id: number; subject_id: number | null; status: PAdmissionStatus | null }>("p_admissions") {}

describe("Pagination", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("p_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });

    for (let i = 1; i <= 25; i++) {
      await PUser.create({ name: `User ${i}` });
    }

    await Schema.create("p_subjects", (table) => {
      table.increments("id");
      table.string("title");
      table.integer("parent_id").nullable();
      table.timestamps();
    });
    await Schema.create("p_offerings", (table) => {
      table.increments("id");
      table.integer("subject_id");
      table.timestamps();
    });
    await Schema.create("p_admissions", (table) => {
      table.increments("id");
      table.integer("offering_id");
      table.integer("subject_id").nullable();
      table.string("status").nullable();
      table.timestamps();
    });
  });

  test("paginate returns correct structure", async () => {
    const result = await PUser.paginate(10, 1);
    expect(result.data).toBeInstanceOf(Collection);
    expect(result.data).toHaveLength(10);
    expect(result.current_page).toBe(1);
    expect(result.per_page).toBe(10);
    expect(result.total).toBe(25);
    expect(result.last_page).toBe(3);
    expect(result.from).toBe(1);
    expect(result.to).toBe(10);
  });

  test("paginate page 2", async () => {
    const result = await PUser.paginate(10, 2);
    expect(result.data).toHaveLength(10);
    expect(result.current_page).toBe(2);
    expect(result.from).toBe(11);
    expect(result.to).toBe(20);
  });

  test("paginate last page", async () => {
    const result = await PUser.paginate(10, 3);
    expect(result.data).toHaveLength(5);
    expect(result.from).toBe(21);
    expect(result.to).toBe(25);
  });

  test("paginate with where clause", async () => {
    const result = await PUser.where("name", "like", "User 1%").paginate(5, 1);
    // User 1, User 10-19 = 11 matches
    expect(result.total).toBe(11);
    expect(result.data.length).toBeLessThanOrEqual(5);
  });

  test("paginate total ignores existing limit and offset", async () => {
    const result = await PUser.query().limit(2).offset(10).paginate(5, 1);
    expect(result.total).toBe(25);
    expect(result.data).toHaveLength(5);
    expect(result.last_page).toBe(5);
  });

  test("paginate empty result", async () => {
    const result = await PUser.where("name", "NonExistent").paginate(10, 1);
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });

  test("simplePaginate returns one page without total count metadata", async () => {
    const result = await PUser.orderBy("id").simplePaginate(10, 1);

    expect(result.data).toBeInstanceOf(Collection);
    expect(result.data).toHaveLength(10);
    expect(result.current_page).toBe(1);
    expect(result.per_page).toBe(10);
    expect(result.from).toBe(1);
    expect(result.to).toBe(10);
    expect(result.has_more_pages).toBe(true);
    expect(result.next_page).toBe(2);
    expect(result.prev_page).toBeNull();
    expect((result as any).total).toBeUndefined();
    expect((result as any).last_page).toBeUndefined();
  });

  test("simplePaginate handles later and empty pages", async () => {
    const last = await PUser.orderBy("id").simplePaginate(10, 3);
    expect(last.from).toBe(21);
    expect(last.to).toBe(20 + last.data.length);
    expect(last.data.length).toBeGreaterThan(0);
    expect(last.data.length).toBeLessThanOrEqual(10);
    expect(last.has_more_pages).toBe(false);
    expect(last.next_page).toBeNull();
    expect(last.prev_page).toBe(2);

    const empty = await PUser.where("name", "NonExistent").simplePaginate(10, 2);
    expect(empty.data).toHaveLength(0);
    expect(empty.from).toBe(0);
    expect(empty.to).toBe(0);
    expect(empty.has_more_pages).toBe(false);
  });

  test("cursorPaginate returns cursor links and fetches the next page", async () => {
    const first = await PUser.orderBy("id").cursorPaginate(7);

    expect(first.data).toHaveLength(7);
    expect(first.data[0].getAttribute("name")).toBe("User 1");
    expect(first.data[6].getAttribute("name")).toBe("User 7");
    expect(first.per_page).toBe(7);
    expect(first.has_more_pages).toBe(true);
    expect(first.next_cursor).toBeTruthy();
    expect(first.prev_cursor).toBeNull();

    const second = await PUser.orderBy("id").cursorPaginate(7, first.next_cursor);
    expect(second.data).toHaveLength(7);
    expect(second.data[0].getAttribute("name")).toBe("User 8");
    expect(second.data[6].getAttribute("name")).toBe("User 14");
    expect(second.prev_cursor).toBe(first.next_cursor);
  });

  test("cursorPaginate supports non-unique order columns with primary key tie-breaker", async () => {
    const first = await PUser.orderBy("name").cursorPaginate(5);
    const second = await PUser.orderBy("name").cursorPaginate(5, first.next_cursor);

    expect(first.data.map((user) => user.getAttribute("id"))).not.toEqual(second.data.map((user) => user.getAttribute("id")));
    expect(new Set([...first.data, ...second.data].map((user) => user.getAttribute("id"))).size).toBe(10);
  });

  test("simple and cursor paginator json infers model attributes", async () => {
    const simple = await PSubject.orderBy("id").simplePaginate(10, 1);
    const cursor = await PSubject.orderBy("id").cursorPaginate(10);

    const simpleRow = simple.data[0];
    const cursorRow = cursor.data[0];
    const _simpleModelTitle: string | undefined = simpleRow?.title;
    const _cursorModelParentId: number | null | undefined = cursorRow?.parent_id;
    const _simpleHasMore: boolean = simple.has_more_pages;
    const _cursorNext: string | null = cursor.next_cursor;

    const simpleJson = simple.json();
    const cursorJson = cursor.json();

    type SimpleRow = (typeof simpleJson.data)[number];
    type CursorRow = (typeof cursorJson.data)[number];
    const _simpleTitle: SimpleRow["title"] extends string ? true : false = true;
    const _cursorParentId: CursorRow["parent_id"] extends number | null ? true : false = true;
    simpleJson.has_more_pages;
    cursorJson.next_cursor;
    expect(simpleJson.data).toBeArray();
    expect(cursorJson.data).toBeArray();
    expect(typeof simpleJson.has_more_pages).toBe("boolean");
    expect(cursorJson.next_cursor === null || typeof cursorJson.next_cursor === "string").toBe(true);
    // @ts-expect-error paginator data rows should not admit unknown model fields.
    simple.data[0]?.missing_field;
    // @ts-expect-error cursor paginator JSON rows should not admit unknown model fields.
    cursorJson.data[0]?.missing_field;
    // @ts-expect-error simple paginator does not expose total count metadata.
    simpleJson.total;
    // @ts-expect-error cursor paginator does not expose page numbers.
    cursorJson.current_page;
  });

  test("paginate json infers model attributes", async () => {
    const pageResult = await PSubject.whereNull("parent_id")
      .orderBy("title")
      .paginate(10, 1);

    const json = pageResult.json();

    type Row = (typeof json.data)[number];
    const _id: Row["id"] extends number ? true : false = true;
    const _title: Row["title"] extends string ? true : false = true;
    const _parentId: Row["parent_id"] extends number | null ? true : false = true;
    // @ts-expect-error Unknown keys should not be admitted by paginator JSON rows.
    type Missing = Row["missing"];

    expect(json.data).toHaveLength(0);
    expect(_id).toBe(true);
    expect(_title).toBe(true);
    expect(_parentId).toBe(true);
  });

  test("paginate json infers withExists aliases", async () => {
    const usedSubject = await PSubject.create({ title: "Used", parent_id: null });
    await PSubject.create({ title: "Unused", parent_id: null });
    const offering = await POffering.create({ subject_id: usedSubject.id });
    await PAdmission.create({ offering_id: offering.id, subject_id: usedSubject.id, status: PAdmissionStatus.ENROLLED });

    const pageResult = await PSubject
      .withExists("offerings", "in_used", (offeringQuery) => offeringQuery.has("admissions"))
      .whereNull("parent_id")
      .orderBy("title")
      .paginate(10, 1);

    const json = pageResult.json();

    type Row = (typeof json.data)[number];
    const _inUsed: Row["in_used"] extends boolean ? true : false = true;

    const used = json.data.find((subject) => subject.title === "Used");
    const unused = json.data.find((subject) => subject.title === "Unused");

    expect(used?.in_used).toBe(true);
    expect(unused?.in_used).toBe(false);
    expect(_inUsed).toBe(true);
  });

  test("withExists supports Laravel-style overloads", async () => {
    const usedSubject = await PSubject.create({ title: "Overload Used", parent_id: null });
    await PSubject.create({ title: "Overload Unused", parent_id: null });
    const offering = await POffering.create({ subject_id: usedSubject.id });
    await PAdmission.create({ offering_id: offering.id, subject_id: usedSubject.id, status: PAdmissionStatus.ENROLLED });

    const relationOnlyBuilder = PSubject.withExists("offerings");
    const relationCallbackBuilder = PSubject.withExists("offerings", (offeringQuery) => offeringQuery.has("admissions"));
    const relationAliasBuilder = PSubject.withExists("offerings", "in_used", (offeringQuery) => offeringQuery.has("admissions"));
    const directRelationCallbackBuilder = PSubject.withExists("admissions", (admissionQuery) => {
      const _query: RelationConstraintQuery<PSubject, "admissions"> = admissionQuery;
      admissionQuery.where("status", PAdmissionStatus.ENROLLED);
      return _query;
    });
    const mapBuilder = PSubject.withExists({
      offerings: (offeringQuery) => offeringQuery.has("admissions"),
    });
    const mapAliasBuilder = PSubject.withExists({
      "offerings as has_used_offerings": (offeringQuery) => offeringQuery.has("admissions"),
    });
    const mapDirectAliasBuilder = PSubject.withExists({
      "admissions as has_enrolled_admissions": (admissionQuery) => {
        const _query: RelationConstraintQuery<PSubject, "admissions"> = admissionQuery;
        admissionQuery.where("status", PAdmissionStatus.ENROLLED);
        return _query;
      },
    });

    type RelationOnly = NonNullable<Awaited<ReturnType<typeof relationOnlyBuilder.first>>>;
    type RelationCallback = NonNullable<Awaited<ReturnType<typeof relationCallbackBuilder.first>>>;
    type RelationAlias = NonNullable<Awaited<ReturnType<typeof relationAliasBuilder.first>>>;
    type DirectRelationCallback = NonNullable<Awaited<ReturnType<typeof directRelationCallbackBuilder.first>>>;
    type MapResult = NonNullable<Awaited<ReturnType<typeof mapBuilder.first>>>;
    type MapAlias = NonNullable<Awaited<ReturnType<typeof mapAliasBuilder.first>>>;
    type MapDirectAlias = NonNullable<Awaited<ReturnType<typeof mapDirectAliasBuilder.first>>>;

    const _relationOnly: ReturnType<RelationOnly["json"]>["offerings_exists"] extends boolean ? true : false = true;
    const _relationCallback: ReturnType<RelationCallback["json"]>["offerings_exists"] extends boolean ? true : false = true;
    const _relationAlias: ReturnType<RelationAlias["json"]>["in_used"] extends boolean ? true : false = true;
    const _directRelationCallback: ReturnType<DirectRelationCallback["json"]>["admissions_exists"] extends boolean ? true : false = true;
    const _mapDefault: ReturnType<MapResult["json"]>["offerings_exists"] extends boolean ? true : false = true;
    const _mapAlias: ReturnType<MapAlias["json"]>["has_used_offerings"] extends boolean ? true : false = true;
    const _mapDirectAlias: ReturnType<MapDirectAlias["json"]>["has_enrolled_admissions"] extends boolean ? true : false = true;
    // @ts-expect-error Object-map alias should not expose the raw "relation as alias" key.
    type InvalidMapAliasKey = ReturnType<MapAlias["json"]>["offerings as has_used_offerings"];

    const pageResult = await relationCallbackBuilder
      .withExists({
        "offerings as has_used_offerings": (offeringQuery) => offeringQuery.has("admissions"),
      })
      .whereIn("title", ["Overload Used", "Overload Unused"])
      .orderBy("title")
      .paginate(10, 1);

    const defaultOnly = await PSubject
      .withExists("offerings")
      .where("title", "Overload Used")
      .first();

    const json = pageResult.json();

    type Row = (typeof json.data)[number];
    const _defaultExists: Row["offerings_exists"] extends boolean ? true : false = true;
    const _aliasedExists: Row["has_used_offerings"] extends boolean ? true : false = true;

    const used = json.data.find((subject) => subject.title === "Overload Used");
    const unused = json.data.find((subject) => subject.title === "Overload Unused");

    expect(used?.offerings_exists).toBe(true);
    expect(unused?.offerings_exists).toBe(false);
    expect(used?.has_used_offerings).toBe(true);
    expect(unused?.has_used_offerings).toBe(false);
    expect(defaultOnly?.offerings_exists).toBe(true);
    expect(_relationOnly).toBe(true);
    expect(_relationCallback).toBe(true);
    expect(_relationAlias).toBe(true);
    expect(_directRelationCallback).toBe(true);
    expect(_mapDefault).toBe(true);
    expect(_mapAlias).toBe(true);
    expect(_mapDirectAlias).toBe(true);
    expect(_defaultExists).toBe(true);
    expect(_aliasedExists).toBe(true);
  });

  test("with relation callback infers related query type", async () => {
    const subject = await PSubject.create({ title: "Constrained Subject", parent_id: null });
    await PAdmission.create({ offering_id: 0, subject_id: subject.id, status: PAdmissionStatus.ENROLLED });
    await PAdmission.create({ offering_id: 0, subject_id: subject.id, status: null });

    const builder = PSubject.with("admissions", (admissionQuery) => {
      const _query: RelationConstraintQuery<PSubject, "admissions"> = admissionQuery;
      admissionQuery.where("status", PAdmissionStatus.ENROLLED);
      return _query;
    });

    const found = await builder.where("title", "Constrained Subject").first();
    const admissions = found?.getRelation("admissions");

    expect(admissions).toHaveLength(1);
    expect(admissions[0].status).toBe(PAdmissionStatus.ENROLLED);
  });
});
