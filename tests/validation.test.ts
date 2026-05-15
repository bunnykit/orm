import { expect, test, describe, beforeAll } from "bun:test";
import { rule, Validator, ValidationError, DB, Schema, ConnectionManager, type RuleContract, type ValidationContext } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

function expectType<T>(_value: T): void {}

describe("Validator — sync rules", () => {
  test("required fails on absent / empty", async () => {
    const v = Validator.make({}, { name: rule().required().string() });
    expect(await v.fails()).toBe(true);
    expect((await v.errors()).name?.[0]).toContain("required");
  });

  test("fields are optional unless an implicit presence rule requires them", async () => {
    expect(
      await Validator.make(
        {},
        {
          email: rule().email(),
          age: rule().integer().min(18),
        },
      ).passes(),
    ).toBe(true);

    expect(
      await Validator.make(
        {},
        {
          email: rule().required().email(),
        },
      ).fails(),
    ).toBe(true);

    expect(
      await Validator.make(
        { type: "business" },
        {
          company: rule().requiredIf("type", "business").string(),
        },
      ).fails(),
    ).toBe(true);
  });

  test("passes and returns coerced output", async () => {
    const out = await Validator.make(
      { age: "42", name: "  Alice  " },
      {
        age: rule().required().integer(),
        name: rule().required().string().trim(),
      },
    ).validate();
    expect(out.age).toBe(42);          // coerced string → number
    expect(out.name).toBe("Alice");    // trimmed
  });

  test("email / min / max / between / in", async () => {
    const schema = {
      email: rule().required().email(),
      pin: rule().required().integer().between(1000, 9999),
      role: rule().in(["admin", "member"] as const),
      bio: rule().nullable().string().max(5),
    };
    const ok = await Validator.make(
      { email: "a@b.com", pin: 1234, role: "admin", bio: null },
      schema,
    ).validate();
    expect(ok.role).toBe("admin");
    expect(ok.bio).toBeNull();

    const bad = Validator.make(
      { email: "nope", pin: 5, role: "x" },
      schema,
    );
    const errs = await bad.errors();
    expect(errs.email).toBeDefined();
    expect(errs.pin).toBeDefined();
    expect(errs.role).toBeDefined();
  });

  test("confirmed / same / different", async () => {
    const schema = {
      password: rule().required().string().min(8).confirmed(),
      a: rule().same("b"),
      c: rule().different("b"),
    };
    const ok = await Validator.make(
      { password: "longenough", password_confirmation: "longenough", a: 1, b: 1, c: 2 },
      schema,
    ).passes();
    expect(ok).toBe(true);

    const bad = await Validator.make(
      { password: "longenough", password_confirmation: "mismatch", a: 1, b: 1, c: 1 },
      schema,
    ).errors();
    expect(bad.password).toBeDefined();
    expect(bad.c).toBeDefined();
  });

  test("sometimes skips when absent, default fills", async () => {
    const out = await Validator.make(
      {},
      {
        nickname: rule().sometimes().string(),
        role: rule().default("member"),
      },
    ).validate();
    expect("nickname" in out).toBe(false);
    expect(out.role).toBe("member");
  });

  test("default can be declared after validation rules", async () => {
    const out = await Validator.make(
      {},
      { role: rule().in(["admin", "member"] as const).default("member") },
    ).validate();
    expect(out.role).toBe("member");
  });

  test("requiredIf", async () => {
    const schema = {
      type: rule().required().string(),
      company: rule().requiredIf("type", "business").string(),
    };
    expect(
      await Validator.make({ type: "personal" }, schema).passes(),
    ).toBe(true);
    expect(
      await Validator.make({ type: "business" }, schema).fails(),
    ).toBe(true);
    expect(
      await Validator.make({ type: "personal", company: 123 }, schema).fails(),
    ).toBe(true);
  });

  test("conditional rules accept multiple expected values", async () => {
    expect(
      await Validator.make(
        { type: "test2" },
        { name: rule().requiredIf("type", ["test", "test2"]).string() },
      ).fails(),
    ).toBe(true);

    expect(
      await Validator.make(
        { type: "draft" },
        { name: rule().requiredUnless("type", ["draft", "archived"]).string() },
      ).passes(),
    ).toBe(true);

    const out = await Validator.make(
      { type: "private", debug: "remove" },
      { debug: rule().excludeIf("type", ["private", "internal"]).string() },
    ).validate();
    expect("debug" in out).toBe(false);

    const errs = await Validator.make(
      { role: "member", admin: "nope" },
      { admin: rule().prohibitedUnless("role", ["admin", "owner"]) },
    ).errors();
    expect(errs.admin).toBeDefined();
  });

  test("remaining type, size, and format rules", async () => {
    const ok = await Validator.make(
      {
        enabled: "1",
        tags: ["a", "b"],
        starts_at: "2026-05-15T00:00:00.000Z",
        website: "https://example.com",
        id: "550e8400-e29b-41d4-a716-446655440000",
        slug: "abc",
        code: "abc123",
        sku: "ABC-123",
        score: "9.5",
        choices: ["x", "y"],
      },
      {
        enabled: rule().boolean(),
        tags: rule().array().size(2),
        starts_at: rule().date(),
        website: rule().url(),
        id: rule().uuid(),
        slug: rule().alpha(),
        code: rule().alphaNum(),
        sku: rule().regex(/^[A-Z]+-\d+$/),
        score: rule().number().min(5).max(10),
        choices: rule().array().between(1, 3),
        banned: rule().sometimes().notIn(["root"]),
        present: rule().requiredWith("slug").filled(),
      },
    ).messages({ present: "present needed" }).errors();

    expect(ok.present?.[0]).toBe("present needed");

    const out = await Validator.make(
      {
        enabled: "false",
        tags: ["a", "b"],
        starts_at: "2026-05-15",
        website: "https://example.com",
        id: "550e8400-e29b-41d4-a716-446655440000",
        slug: "abc",
        code: "abc123",
        sku: "ABC-123",
        score: "9.5",
        choices: ["x", "y"],
        present: "value",
      },
      {
        enabled: rule().boolean(),
        tags: rule().array().size(2),
        starts_at: rule().date(),
        website: rule().url(),
        id: rule().uuid(),
        slug: rule().alpha(),
        code: rule().alphaNum(),
        sku: rule().regex(/^[A-Z]+-\d+$/),
        score: rule().number().min(5).max(10),
        choices: rule().array().between(1, 3),
        present: rule().requiredWith("slug").filled(),
      },
    ).validate();

    expect(out.enabled).toBe(false);
    expect(out.starts_at).toBeInstanceOf(Date);
    expect(out.score).toBe(9.5);
  });

  test("ValidationError carries a bag", async () => {
    try {
      await Validator.make({}, { name: rule().required() }).validate();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const ve = e as ValidationError;
      expect(ve.first("name")).toContain("required");
      expect(ve.all().length).toBeGreaterThan(0);
    }
  });

  test("custom messages override defaults", async () => {
    const errs = await Validator.make(
      {},
      { email: rule().required().email() },
    )
      .messages({ "email.required": "We need your email." })
      .errors();
    expect(errs.email[0]).toBe("We need your email.");
  });

  test("stopOnFirstFailure stops validation for the entire payload", async () => {
    const errs = await Validator.make(
      { email: "", name: "" },
      {
        email: rule().required().email(),
        name: rule().required().string(),
      },
    )
      .stopOnFirstFailure()
      .errors();

    expect(Object.keys(errs)).toEqual(["email"]);
    expect(errs.email).toHaveLength(1);
    expect(errs.name).toBeUndefined();
  });

  test("collectAllErrors keeps validating a field after its first failure", async () => {
    const errs = await Validator.make(
      { email: "", password: [] },
      {
        email: rule().required().email(),
        password: rule().string().min(8),
      },
    )
      .collectAllErrors()
      .errors();

    expect(errs.email).toHaveLength(2);
    expect(errs.email[0]).toContain("required");
    expect(errs.email[1]).toContain("valid email");
    expect(errs.password).toHaveLength(2);
    expect(errs.password[0]).toContain("string");
    expect(errs.password[1]).toContain("at least");
  });

  test("custom messages support nested arrays, exact keys, and wildcard keys", async () => {
    const errs = await Validator.make(
      {
        items: [
          { sku: "", qty: "2" },
          { sku: "ABC", qty: "bad" },
          { sku: "ABC", qty: "3" },
        ],
      },
      {
        "items.*.sku": rule().required().distinct(),
        "items.*.qty": rule().integer().min(1),
      },
    )
      .messages({
        "items.0.sku.required": "The first SKU is required.",
        "items.*.sku.distinct": "Each SKU must be unique.",
        "items.*.qty.integer": "Each quantity must be a number.",
      })
      .errors();

    expect(errs["items.0.sku"][0]).toBe("The first SKU is required.");
    expect(errs["items.1.sku"][0]).toBe("Each SKU must be unique.");
    expect(errs["items.2.sku"][0]).toBe("Each SKU must be unique.");
    expect(errs["items.1.qty"][0]).toBe("Each quantity must be a number.");
  });

  test("array and nested validated output preserves structure", async () => {
    const out = await Validator.make(
      {
        tags: ["admin", "member"],
        items: [
          { sku: "A1", qty: "2" },
          { sku: "B2", qty: "3" },
        ],
      },
      {
        tags: rule().array().contains(["admin"]).doesntContain(["root"]),
        "items.*.sku": rule().required().string().distinct(),
        "items.*.qty": rule().required().integer().min(1),
      },
    ).validate();

    expect(out.tags).toEqual(["admin", "member"]);
    expect(out.items[0].sku).toBe("A1");
    expect(out.items[0].qty).toBe(2);
    expect(out.items[1].qty).toBe(3);
  });

  test("custom validators can be inline callbacks or reusable RuleContract objects", async () => {
    class EvenRule implements RuleContract {
      name = "even";
      validate(value: unknown) {
        return typeof value === "number" && value % 2 === 0;
      }
      message(ctx: ValidationContext) {
        return `The ${ctx.attribute} field must be even.`;
      }
    }

    const ok = await Validator.make(
      { code: "BUN-123", count: 4 },
      {
        code: rule().custom(
          "starts_with_bun",
          (value) => typeof value === "string" && value.startsWith("BUN-"),
          "The :attribute field must start with BUN-.",
        ),
        count: rule().number().use(new EvenRule()),
      },
    ).passes();
    expect(ok).toBe(true);

    const errs = await Validator.make(
      { code: "NOPE", count: 3 },
      {
        code: rule().custom("starts_with_bun", (value) => typeof value === "string" && value.startsWith("BUN-")),
        count: rule().number().use(new EvenRule()),
      },
    )
      .messages({ "code.starts_with_bun": "Code must use the BUN prefix." })
      .errors();

    expect(errs.code[0]).toBe("Code must use the BUN prefix.");
    expect(errs.count[0]).toBe("The count field must be even.");
  });

  test("infers validated output types", async () => {
    const validated = await Validator.make(
      { email: "a@b.com", age: "18", password: "password", password_confirmation: "password" },
      {
        email: rule().required().string().email(),
        age: rule().required().integer().min(18),
        password: rule().required().string().min(8).confirmed(),
        role: rule().in(["admin", "member"] as const).default("member"),
        nickname: rule().sometimes().string(),
        deleted_at: rule().nullable().date(),
      },
    ).validate();

    expectType<string>(validated.email);
    expectType<number>(validated.age);
    expectType<"admin" | "member">(validated.role);
    expectType<string | undefined>(validated.nickname);
    expectType<Date | null>(validated.deleted_at);
    expect(validated.role).toBe("member");
  });

  test("Laravel-style presence, prohibition, exclusion, and acceptance rules stay chainable", async () => {
    const out = await Validator.make(
      {
        terms: "yes",
        marketing: "no",
        type: "person",
        name: "Ada",
        nickname: undefined,
        token: "secret",
        debug: "drop-me",
        a: "present",
      },
      {
        terms: rule().accepted(),
        marketing: rule().declined(),
        name: rule().requiredUnless("type", "company").string(),
        nickname: rule().presentWith("name"),
        company: rule().missingIf("type", "person"),
        admin: rule().prohibitedUnless("type", "admin"),
        token: rule().prohibits("password"),
        debug: rule().excludeIf("type", "person"),
        b: rule().requiredWithout("a"),
      },
    ).validate();

    expect(out.terms).toBe("yes");
    expect("debug" in out).toBe(false);
    expect("b" in out).toBe(false);

    const errs = await Validator.make(
      { terms: "no", marketing: "yes", type: "person", company: "Acme", admin: true },
      {
        terms: rule().accepted(),
        marketing: rule().declined(),
        company: rule().missingIf("type", "person"),
        admin: rule().prohibitedUnless("type", "admin"),
      },
    ).errors();
    expect(errs.terms).toBeDefined();
    expect(errs.marketing).toBeDefined();
    expect(errs.company).toBeDefined();
    expect(errs.admin).toBeDefined();
  });

  test("Laravel-style date, numeric, string, array, nested, and file rules", async () => {
    enum Status {
      Active = "active",
      Paused = "paused",
    }
    const Flags = { open: false, closed: true } as const;

    const file = { name: "avatar.png", type: "image/png", size: 1024, width: 200, height: 100 };
    const out = await Validator.make(
      {
        start: "2026-05-15",
        end: "2026-05-16",
        timezone: "Asia/Manila",
        amount: "12.50",
        pin: "1234",
        even: 12,
        slug: "abc-123",
        title: "ABC",
        ip: "127.0.0.1",
        color: "#ff00aa",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        tags: ["a", "b"],
        profile: { name: "Ada", role: "active" },
        flag: false,
        items: [{ email: "a@example.com" }, { email: "b@example.com" }],
        avatar: file,
        password: "Secret123!",
        password_confirmation: "Secret123!",
        flexible: "x@example.com",
      },
      {
        start: rule().dateFormat("Y-m-d").before("end"),
        end: rule().date().afterOrEqual("start"),
        timezone: rule().timezone(),
        amount: rule().decimal(2).numeric(),
        pin: rule().digits(4).digitsBetween(4, 6),
        even: rule().number().multipleOf(2).gte(10).lt(20),
        slug: rule().alphaDash().startsWith("abc").doesntEndWith("zzz"),
        title: rule().uppercase().ascii(),
        ip: rule().ipv4(),
        color: rule().hexColor(),
        id: rule().ulid(),
        tags: rule().list().contains(["a"]).doesntContain(["z"]),
        profile: rule().array(["name", "role"]).requiredArrayKeys("name", "role"),
        "profile.role": rule().enum(Status),
        flag: rule().enum(Flags),
        "items.*.email": rule().email().distinct(),
        avatar: rule().file().image().mimes("png").mimeTypes("image/png").dimensions({ ratio: 2 }),
        password: rule().password((p) => p.min(10).letters().mixedCase().numbers().symbols()).confirmed(),
        flexible: rule().anyOf(rule().email(), rule().uuid()),
      },
    ).validate();

    expect(out.profile.name).toBe("Ada");
    expect(out.items[1].email).toBe("b@example.com");
    expect(out.avatar).toBe(file);
  });
});

describe("Validator — DB-aware async rules", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("val_users", (t) => {
      t.increments("id");
      t.string("email").unique();
      t.string("name");
      t.timestamps();
    });
    await DB.table("val_users").insert({ email: "taken@example.com", name: "Existing" });
  });

  test("unique fails when row exists", async () => {
    const errs = await Validator.make(
      { email: "taken@example.com" },
      { email: rule().required().email().unique("val_users", "email") },
    ).errors();
    expect(errs.email?.[0]).toContain("already been taken");
  });

  test("unique passes for fresh value", async () => {
    expect(
      await Validator.make(
        { email: "fresh@example.com" },
        { email: rule().required().email().unique("val_users", "email") },
      ).passes(),
    ).toBe(true);
  });

  test("unique ignore skips the current row", async () => {
    const row = (await DB.table("val_users").where("email", "taken@example.com").first())!;
    expect(
      await Validator.make(
        { email: "taken@example.com" },
        { email: rule().unique("val_users", "email").ignore(row.id) },
      ).passes(),
    ).toBe(true);
  });

  test("unique ignore builder skips the current row", async () => {
    const row = (await DB.table("val_users").where("email", "taken@example.com").first())!;
    expect(
      await Validator.make(
        { email: "taken@example.com" },
        { email: rule().unique("val_users", "email").ignore(row.id).where("name", "Existing") },
      ).passes(),
    ).toBe(true);
  });

  test("exists passes/fails", async () => {
    expect(
      await Validator.make(
        { email: "taken@example.com" },
        { email: rule().exists("val_users", "email") },
      ).passes(),
    ).toBe(true);
    expect(
      await Validator.make(
        { email: "ghost@example.com" },
        { email: rule().exists("val_users", "email") },
      ).fails(),
    ).toBe(true);
  });

  test("database rules accept chainable where constraints", async () => {
    expect(
      await Validator.make(
        { email: "taken@example.com" },
        { email: rule().exists("val_users", "email").where("name", "Existing") },
      ).passes(),
    ).toBe(true);
    expect(
      await Validator.make(
        { email: "taken@example.com" },
        { email: rule().exists("val_users", "email").whereNot("name", "Existing") },
      ).fails(),
    ).toBe(true);
  });
});

describe("Validator — tenant-scoped unique", () => {
  test("unique resolves against the active tenant connection", async () => {
    // schema-qualify tenant pointing at the same in-memory db; the table
    // is shared, so unique still works against it through DB.tenant.
    ConnectionManager.setTenantResolver(() => ({
      strategy: "schema",
      name: "val-tenant",
      schema: "main",
      mode: "qualify",
    }));

    await DB.tenant("acme", async () => {
      const passed = await Validator.make(
        { email: "tenant-fresh@example.com" },
        { email: rule().unique("val_users", "email") },
      ).passes();
      expect(passed).toBe(true);
    });
  });
});
