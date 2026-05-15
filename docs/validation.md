# Validation

Bunny includes an async, typed validator with Laravel-style rule chains and no string DSL.

```ts
import { Validator, rule } from "@bunnykit/orm";

const validated = await Validator.make(input, {
  email: rule().required().string().email().unique("users", "email"),
  age: rule().required().integer().min(18),
  password: rule().required().string().min(8).confirmed(),
  role: rule().in(["admin", "member"] as const).default("member"),
}).validate();
```

Fields are optional by default. Non-presence rules only run when the field is present:

```ts
await Validator.make({}, {
  email: rule().email(), // passes when missing
}).passes();

await Validator.make({}, {
  email: rule().required().email(), // fails when missing
}).passes();
```

`validate()` returns the coerced, typed output or throws `ValidationError` with an error bag:

```ts
try {
  await Validator.make(input, {
    email: rule().required().email(),
  }).validate();
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.errors.email);
  }
}
```

## API

```ts
const validator = Validator.make(data, schema);

await validator.validate();  // throws ValidationError on failure
await validator.validated(); // alias
await validator.passes();    // boolean
await validator.fails();     // boolean
await validator.errors();    // Record<string, string[]>

validator.stopOnFirstFailure(); // stop after the first failed field
validator.collectAllErrors();   // collect every failed rule per field
```

To inspect errors without throwing, keep the validator instance and call `fails()` / `errors()`:

```ts
const validator = Validator.make(input, {
  email: rule().required().email(),
  password: rule().required().string().min(8),
});

if (await validator.fails()) {
  const errors = await validator.errors();
  console.log(errors.email);
}
```

Use `messages()` to override default messages. Keys can target a whole field or a specific rule:

```ts
await Validator.make(input, {
  email: rule().required().email(),
})
  .messages({
    email: "Enter a valid email address.",
    "email.required": "Email is required.",
  })
  .validate();
```

Nested array paths support exact and wildcard message keys. Resolution order is:

1. exact field + rule, like `items.0.sku.required`
2. exact field, like `items.0.sku`
3. wildcard field + rule, like `items.*.sku.required`
4. wildcard field, like `items.*.sku`
5. the rule's default message

```ts
await Validator.make(input, {
  "items.*.sku": rule().required().distinct(),
  "items.*.qty": rule().integer().min(1),
})
  .messages({
    "items.0.sku.required": "The first SKU is required.",
    "items.*.sku.distinct": "Each SKU must be unique.",
    "items.*.qty.integer": "Each quantity must be a number.",
  })
  .validate();
```

Use `stopOnFirstFailure()` when you only need the first validation error for the entire payload:

```ts
const errors = await Validator.make(input, {
  email: rule().required().email().unique("users", "email"),
  name: rule().required().string(),
})
  .stopOnFirstFailure()
  .errors();
```

If `email` fails, `name` is not validated. Without `stopOnFirstFailure()`, validation still stops after the first failed rule per field, but continues validating the rest of the payload.

Use `collectAllErrors()` when you want every rule failure for each field:

```ts
const errors = await Validator.make(input, {
  email: rule().required().email(),
  password: rule().string().min(8),
})
  .collectAllErrors()
  .errors();
```

With `collectAllErrors()`, an empty `email` can return both the `required` and `email` messages for that field. Rules that intentionally skip or exclude a field, such as `nullable()`, `sometimes()`, and `excludeIf()`, still short-circuit that field.

## Rules

Presence:

```ts
rule().required()
rule().nullable()
rule().sometimes()
rule().requiredIf("type", "business")
rule().requiredIf("type", ["test", "test2"])
rule().requiredUnless("type", "personal")
rule().requiredUnless("type", ["draft", "archived"])
rule().requiredWith("email")
rule().requiredWithAll("first", "last")
rule().requiredWithout("email")
rule().requiredWithoutAll("email", "phone")
rule().filled()
rule().accepted()
rule().acceptedIf("type", "terms")
rule().acceptedIf("type", ["terms", "checkout"])
rule().declined()
rule().declinedIf("type", "opt_out")
rule().declinedIf("type", ["opt_out", "unsubscribe"])
rule().present()
rule().presentIf("type", "business")
rule().presentIf("type", ["business", "enterprise"])
rule().presentUnless("type", "personal")
rule().presentUnless("type", ["personal", "guest"])
rule().presentWith("name")
rule().presentWithAll("first", "last")
rule().missing()
rule().missingIf("type", "person")
rule().missingIf("type", ["person", "guest"])
rule().missingUnless("type", "admin")
rule().missingUnless("type", ["admin", "owner"])
rule().missingWith("token")
rule().missingWithAll("token", "secret")
rule().prohibited()
rule().prohibitedIf("role", "member")
rule().prohibitedIf("role", ["member", "guest"])
rule().prohibitedUnless("role", "admin")
rule().prohibitedUnless("role", ["admin", "owner"])
rule().prohibits("password")
rule().exclude()
rule().excludeIf("type", "person")
rule().excludeIf("type", ["person", "guest"])
rule().excludeUnless("type", "business")
rule().excludeUnless("type", ["business", "enterprise"])
rule().excludeWith("token")
rule().excludeWithout("token")
```

Presence rules decide whether a field must exist, may be omitted, or should be removed from the validated output.

| Rule | Meaning |
|---|---|
| `required()` | Field must be present and not `undefined`, `null`, empty string, or empty array. |
| `nullable()` | `null` / `undefined` is allowed and skips the rest of this field's rules. |
| `sometimes()` | If the field is missing, skip validation for it. If present, validate normally. |
| `filled()` | If the field is present, it must not be empty. Missing is allowed. |
| `requiredIf(field, valueOrValues)` | Required when another field equals the given value, or any value in the given array. |
| `requiredUnless(field, valueOrValues)` | Required unless another field equals the given value, or any value in the given array. |
| `requiredWith(field)` | Required when another field is present and not empty. |
| `requiredWithAll(...fields)` | Required when all listed fields are present and not empty. |
| `requiredWithout(...fields)` | Required when any listed field is missing or empty. |
| `requiredWithoutAll(...fields)` | Required when all listed fields are missing or empty. |
| `accepted()` | Value must be an accepted truthy consent value: `true`, `"yes"`, `"on"`, `1`, or `"1"`. |
| `acceptedIf(field, valueOrValues)` | Must be accepted only when another field equals the given value, or any value in the given array. |
| `declined()` | Value must be a declined consent value: `false`, `"no"`, `"off"`, `0`, or `"0"`. |
| `declinedIf(field, valueOrValues)` | Must be declined only when another field equals the given value, or any value in the given array. |
| `present()` | Key must exist in the input, but the value may be empty. |
| `presentIf(field, valueOrValues)` | Key must exist when another field equals the given value, or any value in the given array. |
| `presentUnless(field, valueOrValues)` | Key must exist unless another field equals the given value, or any value in the given array. |
| `presentWith(...fields)` | Key must exist when any listed field is present. |
| `presentWithAll(...fields)` | Key must exist when all listed fields are present. |
| `missing()` | Key must not exist in the input. |
| `missingIf(field, valueOrValues)` | Key must be missing when another field equals the given value, or any value in the given array. |
| `missingUnless(field, valueOrValues)` | Key must be missing unless another field equals the given value, or any value in the given array. |
| `missingWith(...fields)` | Key must be missing when any listed field is present. |
| `missingWithAll(...fields)` | Key must be missing when all listed fields are present. |
| `prohibited()` | Field must be missing or empty. Unlike `missing()`, an empty value is allowed. |
| `prohibitedIf(field, valueOrValues)` | Field must be missing or empty when another field equals the given value, or any value in the given array. |
| `prohibitedUnless(field, valueOrValues)` | Field must be missing or empty unless another field equals the given value, or any value in the given array. |
| `prohibits(...fields)` | If this field is present and not empty, the listed fields must be missing or empty. |
| `exclude()` | Remove this field from validated output. |
| `excludeIf(field, valueOrValues)` | Remove this field from output when another field equals the given value, or any value in the given array. |
| `excludeUnless(field, valueOrValues)` | Remove this field from output unless another field equals the given value, or any value in the given array. |
| `excludeWith(...fields)` | Remove this field when any listed field is present. |
| `excludeWithout(...fields)` | Remove this field when any listed field is missing or empty. |

Example: make company details conditional without a separate form request object:

```ts
const validated = await Validator.make(input, {
  account_type: rule().required().in(["person", "company"] as const),
  company_name: rule().requiredIf("account_type", "company").string(),
  tax_id: rule().requiredWith("company_name").string(),
  nickname: rule().excludeIf("account_type", "company").string(),
  admin_notes: rule().prohibitedUnless("role", "admin"),
  terms: rule().accepted(),
}).validate();
```

Conditional rules accept either a single expected value or an array of expected values:

```ts
await Validator.make(input, {
  name: rule().requiredIf("type", ["test", "test2"]).string(),
  notes: rule().requiredUnless("status", ["draft", "archived"]).string(),
  debug: rule().excludeIf("visibility", ["private", "internal"]),
}).validate();
```

Type and coercion:

```ts
rule().string()
rule().integer()
rule().number()
rule().numeric()
rule().decimal(2)
rule().digits(4)
rule().digitsBetween(4, 6)
rule().multipleOf(2)
rule().boolean()
rule().array()
rule().array(["name", "role"])
rule().list()
rule().contains(["admin"])
rule().doesntContain(["root"])
rule().distinct()
rule().requiredArrayKeys("name", "role")
rule().date()
rule().dateFormat("Y-m-d")
rule().dateEquals("starts_at")
rule().after("starts_at")
rule().afterOrEqual("starts_at")
rule().before("ends_at")
rule().beforeOrEqual("ends_at")
rule().timezone()
```

`integer()`, `number()`, `numeric()`, `boolean()`, and `date()` coerce common string inputs before later rules run. For example, `rule().integer().min(18)` accepts `"18"` and returns `18` in the validated output.

Array-oriented rules:

| Rule | Meaning |
|---|---|
| `array()` | Value must be an array. |
| `array(["name", "role"])` | Object/array keys must be limited to the listed keys. |
| `list()` | Value must be a JavaScript array. |
| `contains([...])` | Array must contain every listed value. |
| `doesntContain([...])` | Array must not contain any listed value. |
| `distinct()` | Wildcard values such as `items.*.sku` must be unique. |
| `requiredArrayKeys(...keys)` | Object/array must contain the listed keys. |

Date comparison rules can compare against literal dates or another input field:

```ts
await Validator.make(input, {
  starts_at: rule().required().date(),
  ends_at: rule().required().date().afterOrEqual("starts_at"),
  timezone: rule().timezone(),
}).validate();
```

Size:

```ts
rule().min(3)
rule().max(255)
rule().between(1, 10)
rule().size(2)
rule().gt(18)
rule().gte("min_age")
rule().lt(100)
rule().lte("max_age")
```

Size rules work on numbers directly, string length, and array length. `gt`, `gte`, `lt`, and `lte` can compare to a literal number or to the size/value of another field.

Format and membership:

```ts
rule().email()
rule().url()
rule().uuid()
rule().regex(/^[A-Z]+-\d+$/)
rule().alpha()
rule().alphaNum()
rule().alphaDash()
rule().ascii()
rule().startsWith("INV-")
rule().endsWith(".com")
rule().doesntStartWith("tmp")
rule().doesntEndWith(".invalid")
rule().lowercaseOnly()
rule().uppercase()
rule().macAddress()
rule().ip()
rule().ipv4()
rule().ipv6()
rule().activeUrl()
rule().ulid()
rule().hexColor()
rule().in(["admin", "member"] as const)
rule().notIn(["root"])
```

Format rules are usually self-contained string checks. `lowercaseOnly()` validates that a string is already lowercase; `lowercase()` in the transform section converts the value to lowercase.

Cross-field:

```ts
rule().confirmed()      // password_confirmation
rule().same("email")
rule().different("old")
```

`confirmed()` checks the conventional confirmation field. For `password`, it compares against `password_confirmation`. Use `same()` and `different()` for explicit field-to-field comparisons.

Files and higher-level rules:

```ts
rule().file()
rule().image()
rule().mimes("jpg", "png")
rule().mimeTypes("image/png")
rule().extensions("png")
rule().dimensions({ minWidth: 100, ratio: 1 })
rule().enum(Status)
rule().anyOf(rule().email(), rule().uuid())
rule().can((value, ctx) => isAllowed(value, ctx))
rule().password((p) => p.min(12).letters().mixedCase().numbers().symbols())
```

File and image rules validate Bun/Web `File` / `Blob`-like objects with `name`, `type`, and `size` properties. `dimensions()` checks `width` / `height` when those properties are available.

Higher-level rules:

| Rule | Meaning |
|---|---|
| `enum(Status)` | Value must be one of the runtime enum/object values. Supports TypeScript enums and `as const` objects, including boolean literals. |
| `anyOf(ruleA, ruleB)` | Value may pass any one of several rule chains. |
| `can(callback)` | Custom authorization-style boolean check. |
| `custom(name, callback, message?)` | Inline custom validation rule with a named message key. |
| `use(ruleObject)` | Reusable custom rule object implementing `RuleContract`. |
| `password(...)` | Password builder with `min`, `letters`, `mixedCase`, `numbers`, and `symbols`. |

```ts
enum Status {
  Active = "active",
  Paused = "paused",
}

const Visibility = {
  open: false,
  closed: true,
} as const;

await Validator.make(input, {
  status: rule().enum(Status),
  visibility: rule().enum(Visibility),
  destination: rule().anyOf(rule().email(), rule().url()),
  code: rule().custom(
    "starts_with_bun",
    (value) => typeof value === "string" && value.startsWith("BUN-"),
    "The :attribute field must start with BUN-.",
  ),
  password: rule().password((p) => p.min(12).mixedCase().numbers().symbols()),
}).validate();
```

Reusable custom rules implement `RuleContract`:

```ts
import type { RuleContract, ValidationContext } from "@bunnykit/orm";

class EvenRule implements RuleContract {
  name = "even";

  validate(value: unknown) {
    return typeof value === "number" && value % 2 === 0;
  }

  message(ctx: ValidationContext) {
    return `The ${ctx.attribute} field must be even.`;
  }
}

await Validator.make(input, {
  count: rule().number().use(new EvenRule()),
}).validate();
```

Database-aware rules:

```ts
rule().unique("users", "email")
rule().unique("users", "email").ignore(user.id)
rule().unique("users", "email").ignore(user.uuid, "uuid")
rule().exists("roles", "id")
rule().unique("users", "email").where("tenant_id", tenantId)
rule().exists("roles", "id").whereNull("deleted_at")
rule().unique("users", "email").withoutTrashed()
```

DB rules use `TenantContext.current()?.connection` first, then the default connection, so validation inside `DB.tenant()` is tenant-aware.

`where`, `whereNot`, `whereNull`, `whereNotNull`, and `withoutTrashed()` scope `unique()` / `exists()` checks:

```ts
await Validator.make(input, {
  email: rule()
    .required()
    .email()
    .unique("users", "email")
    .ignore(user.id)
    .where("tenant_id", tenantId)
    .withoutTrashed(),
  role_id: rule().exists("roles", "id").whereNull("deleted_at"),
}).validate();
```

Transforms:

```ts
rule().trim()
rule().lowercase()
rule().default("member")
rule().when(isAdmin, (r) => r.required())
rule().unless(isDraft, (r) => r.required())
```

`default()` is applied before validation, even if it appears later in the chain.

## Nested Data

Dotted paths and `*` wildcards are supported:

```ts
await Validator.make(input, {
  "profile.email": rule().email(),
  "items.*.sku": rule().required().distinct(),
}).validate();
```

## Type Inference

Rule chains accumulate their output type:

```ts
const out = await Validator.make(input, {
  age: rule().integer(),
  role: rule().in(["admin", "member"] as const).default("member"),
  nickname: rule().sometimes().string(),
  deleted_at: rule().nullable().date(),
}).validate();

// out.age: number
// out.role: "admin" | "member"
// out.nickname?: string
// out.deleted_at: Date | null
```
