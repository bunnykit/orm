import type { RuleContract } from "./types.js";
import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import {
  RequiredRule,
  NullableRule,
  SometimesRule,
  FilledRule,
  RequiredIfRule,
  RequiredWithRule,
  AcceptedRule,
  AcceptedIfRule,
  DeclinedRule,
  DeclinedIfRule,
  RequiredUnlessRule,
  RequiredWithAllRule,
  RequiredWithoutRule,
  RequiredWithoutAllRule,
  PresentRule,
  PresentIfRule,
  PresentUnlessRule,
  PresentWithRule,
  PresentWithAllRule,
  MissingRule,
  MissingIfRule,
  MissingUnlessRule,
  MissingWithRule,
  MissingWithAllRule,
  ProhibitedRule,
  ProhibitedIfRule,
  ProhibitedUnlessRule,
  ProhibitsRule,
  ExcludeRule,
  ExcludeIfRule,
  ExcludeUnlessRule,
  ExcludeWithRule,
  ExcludeWithoutRule,
  StringRule,
  IntegerRule,
  NumberRule,
  NumericRule,
  DecimalRule,
  DigitsRule,
  DigitsBetweenRule,
  MultipleOfRule,
  BooleanRule,
  ArrayRule,
  ListRule,
  ContainsRule,
  DoesntContainRule,
  DistinctRule,
  RequiredArrayKeysRule,
  DateRule,
  DateFormatRule,
  DateEqualsRule,
  DateComparisonRule,
  TimezoneRule,
  MinRule,
  MaxRule,
  BetweenRule,
  SizeRule,
  ComparisonRule,
  EmailRule,
  PhMobileRule,
  UrlRule,
  UuidRule,
  RegexRule,
  AlphaRule,
  AlphaNumRule,
  AlphaDashRule,
  AsciiRule,
  StartsWithRule,
  EndsWithRule,
  DoesntStartWithRule,
  DoesntEndWithRule,
  LowercaseValidationRule,
  UppercaseRule,
  MacAddressRule,
  IpRule,
  Ipv4Rule,
  Ipv6Rule,
  ActiveUrlRule,
  UlidRule,
  HexColorRule,
  InRule,
  NotInRule,
  ConfirmedRule,
  SameRule,
  DifferentRule,
  FileRule,
  ImageRule,
  MimesRule,
  MimeTypesRule,
  ExtensionsRule,
  DimensionsRule,
  EnumRule,
  AnyOfRule,
  CanRule,
  CustomRule,
  PasswordRule,
  UniqueRule,
  ExistsRule,
  DefaultRule,
  TrimRule,
  LowercaseRule,
} from "./rules.js";

/**
 * Presence marker. "required" means the key must be present in output;
 * "optional" means it may be undefined (sometimes/nullable without default).
 */
type Presence = "required" | "optional";
type Defaulted<TValue, TDefault> = unknown extends TValue
  ? TDefault
  : Exclude<TValue, undefined>;

export type ValidationFile = Blob & {
  name: string;
};

export interface StandardSchemaIssue {
  message: string;
  path?: readonly { key: PropertyKey }[];
}

export interface StandardSchemaResult<T> {
  value: T;
  issues?: undefined;
}

export interface StandardSchemaFailure {
  issues: readonly StandardSchemaIssue[];
}

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
    validate(value: unknown): Promise<StandardSchemaResult<Output> | StandardSchemaFailure> | StandardSchemaResult<Output> | StandardSchemaFailure;
  };
}

function resolveConnection(explicit?: Connection): Connection {
  if (explicit) return explicit;
  const tenant = TenantContext.current()?.connection;
  if (tenant) return tenant;
  const def = ConnectionManager.getDefault();
  if (!def) {
    throw new Error(
      "No connection available for validation. Pass one to Validator.make(data, schema, connection) or set a default.",
    );
  }
  return def;
}

function isAbsent(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

const ROOT_IMPLICIT_RULES = new Set([
  "accepted",
  "accepted_if",
  "default",
  "declined",
  "declined_if",
  "filled",
  "missing",
  "missing_if",
  "missing_unless",
  "missing_with",
  "missing_with_all",
  "present",
  "present_if",
  "present_unless",
  "present_with",
  "present_with_all",
  "prohibited",
  "prohibited_if",
  "prohibited_unless",
  "prohibits",
  "required",
  "required_if",
  "required_unless",
  "required_with",
  "required_with_all",
  "required_without",
  "required_without_all",
]);

/**
 * Fluent rule builder. The two type parameters thread the eventual output
 * type (`TValue`) and whether the field is optional (`TPresence`) so the
 * Validator can infer a fully-typed validated object. Methods mutate the
 * shared spec array and re-cast `this` — zero runtime cost for the typing.
 */
export class RuleBuilder<TValue = unknown, TPresence extends Presence = "required"> {
  /** @internal ordered rule specs */
  readonly specs: RuleContract[] = [];

  /** @internal phantom — never read at runtime */
  declare readonly _value: TValue;
  declare readonly _presence: TPresence;

  private push(rule: RuleContract): this {
    this.specs.push(rule);
    return this;
  }

  private async validateRootValue(input: unknown): Promise<StandardSchemaResult<TValue> | StandardSchemaFailure> {
    let value = input;
    const absent = isAbsent(value);
    const shouldValidateMissing = this.specs.some((ruleObj) => ROOT_IMPLICIT_RULES.has(ruleObj.name));

    if (absent && !shouldValidateMissing) {
      return { value: value as TValue };
    }

    const ctx = {
      attribute: "value",
      pattern: "value",
      data: { value },
      get: (path: string) => (path === "value" ? value : undefined),
      has: (path: string) => path === "value" && !isAbsent(value),
    } as any;

    Object.defineProperty(ctx, "connection", {
      enumerable: true,
      get: () => resolveConnection(),
    });

    const issues: StandardSchemaIssue[] = [];

    for (const ruleObj of this.specs) {
      if (ruleObj.name === "default" && ruleObj.coerce) {
        value = ruleObj.coerce(value);
      }
    }

    for (const ruleObj of this.specs) {
      if (ruleObj.name === "default") continue;
      if (ruleObj.coerce) {
        value = ruleObj.coerce(value);
      }
      const result = await ruleObj.validate(value, ctx);
      const pass = typeof result === "boolean" ? result : result.pass;
      const skip = typeof result === "boolean" ? false : !!result.skip;
      const exclude = typeof result === "boolean" ? false : !!result.exclude;

      if (exclude) {
        return { value: undefined as TValue };
      }
      if (!pass) {
        issues.push({ message: ruleObj.message(ctx) });
      }
      if (skip) {
        break;
      }
    }

    if (issues.length > 0) {
      return { issues };
    }
    return { value: value as TValue };
  }

  get "~standard"(): StandardSchemaV1<unknown, TValue>["~standard"] {
    return {
      version: 1,
      vendor: "bunnykit",
      validate: (value: unknown) => this.validateRootValue(value),
    };
  }

  private last<T extends Record<string, unknown>>(method: keyof T): T | undefined {
    const rule = this.specs[this.specs.length - 1] as unknown as T | undefined;
    return rule && typeof rule[method] === "function" ? rule : undefined;
  }

  // ── Presence ───────────────────────────────────────────────
  /**
   * Require the value to be present and non-empty.
   * Example: `rule().required()`
   */
  required(): RuleBuilder<TValue, "required"> {
    return this.push(new RequiredRule()) as any;
  }
  /**
   * Allow `null` as a valid value.
   * Example: `rule().nullable()`
   */
  nullable(): RuleBuilder<TValue | null, TPresence> {
    return this.push(new NullableRule()) as any;
  }
  /**
   * Make the field optional when it is absent.
   * Example: `rule().sometimes()`
   */
  sometimes(): RuleBuilder<TValue, "optional"> {
    return this.push(new SometimesRule()) as any;
  }
  /**
   * Require a non-empty value if the field is present.
   * Example: `rule().filled()`
   */
  filled(): this {
    return this.push(new FilledRule());
  }
  /**
   * Require the value when another field matches a value.
   * Example: `rule().requiredIf("role", "admin")`
   */
  requiredIf(field: string, value: unknown): this {
    return this.push(new RequiredIfRule(field, value));
  }
  /**
   * Require the value when another field is present.
   * Example: `rule().requiredWith("email")`
   */
  requiredWith(field: string): this {
    return this.push(new RequiredWithRule(field));
  }
  /**
   * Accept truthy form values like `true`, `1`, `"on"`, and `"yes"`.
   * Example: `rule().accepted()`
   */
  accepted(): this {
    return this.push(new AcceptedRule());
  }
  /**
   * Accept the value only when another field matches.
   * Example: `rule().acceptedIf("terms", true)`
   */
  acceptedIf(field: string, value: unknown): this {
    return this.push(new AcceptedIfRule(field, value));
  }
  /**
   * Require the value to be a declined form value.
   * Example: `rule().declined()`
   */
  declined(): this {
    return this.push(new DeclinedRule());
  }
  /**
   * Require the value to be declined when another field matches.
   * Example: `rule().declinedIf("status", "inactive")`
   */
  declinedIf(field: string, value: unknown): this {
    return this.push(new DeclinedIfRule(field, value));
  }
  /**
   * Require the value unless another field matches a value.
   * Example: `rule().requiredUnless("status", "draft")`
   */
  requiredUnless(field: string, value: unknown): this {
    return this.push(new RequiredUnlessRule(field, value));
  }
  /**
   * Require the value when all listed fields are present.
   * Example: `rule().requiredWithAll("start_date", "end_date")`
   */
  requiredWithAll(...fields: string[]): this {
    return this.push(new RequiredWithAllRule(fields));
  }
  /**
   * Require the value when any listed field is missing.
   * Example: `rule().requiredWithout("email", "phone")`
   */
  requiredWithout(...fields: string[]): this {
    return this.push(new RequiredWithoutRule(fields));
  }
  /**
   * Require the value when all listed fields are missing.
   * Example: `rule().requiredWithoutAll("email", "phone")`
   */
  requiredWithoutAll(...fields: string[]): this {
    return this.push(new RequiredWithoutAllRule(fields));
  }
  /**
   * Require the field to exist in the input payload.
   * Example: `rule().present()`
   */
  present(): this {
    return this.push(new PresentRule());
  }
  /**
   * Require the field to exist when another field matches a value.
   * Example: `rule().presentIf("type", "paid")`
   */
  presentIf(field: string, value: unknown): this {
    return this.push(new PresentIfRule(field, value));
  }
  /**
   * Require the field to exist unless another field matches a value.
   * Example: `rule().presentUnless("type", "draft")`
   */
  presentUnless(field: string, value: unknown): this {
    return this.push(new PresentUnlessRule(field, value));
  }
  /**
   * Require the field to exist when any of the listed fields are present.
   * Example: `rule().presentWith("email", "phone")`
   */
  presentWith(...fields: string[]): this {
    return this.push(new PresentWithRule(fields));
  }
  /**
   * Require the field to exist when all of the listed fields are present.
   * Example: `rule().presentWithAll("city", "state")`
   */
  presentWithAll(...fields: string[]): this {
    return this.push(new PresentWithAllRule(fields));
  }
  /**
   * Fail when the field is present.
   * Example: `rule().missing()`
   */
  missing(): this {
    return this.push(new MissingRule());
  }
  /**
   * Fail when the field is present and another field matches a value.
   * Example: `rule().missingIf("role", "admin")`
   */
  missingIf(field: string, value: unknown): this {
    return this.push(new MissingIfRule(field, value));
  }
  /**
   * Fail when the field is present unless another field matches a value.
   * Example: `rule().missingUnless("status", "archived")`
   */
  missingUnless(field: string, value: unknown): this {
    return this.push(new MissingUnlessRule(field, value));
  }
  /**
   * Fail when the field is present with any of the listed fields.
   * Example: `rule().missingWith("password", "token")`
   */
  missingWith(...fields: string[]): this {
    return this.push(new MissingWithRule(fields));
  }
  /**
   * Fail when the field is present with all of the listed fields.
   * Example: `rule().missingWithAll("street", "city")`
   */
  missingWithAll(...fields: string[]): this {
    return this.push(new MissingWithAllRule(fields));
  }
  /**
   * Prohibit the field entirely.
   * Example: `rule().prohibited()`
   */
  prohibited(): this {
    return this.push(new ProhibitedRule());
  }
  /**
   * Prohibit the field when another field matches a value.
   * Example: `rule().prohibitedIf("role", "guest")`
   */
  prohibitedIf(field: string, value: unknown): this {
    return this.push(new ProhibitedIfRule(field, value));
  }
  /**
   * Prohibit the field unless another field matches a value.
   * Example: `rule().prohibitedUnless("mode", "admin")`
   */
  prohibitedUnless(field: string, value: unknown): this {
    return this.push(new ProhibitedUnlessRule(field, value));
  }
  /**
   * Prohibit the listed fields when this field is present.
   * Example: `rule().prohibits("password_confirmation")`
   */
  prohibits(...fields: string[]): this {
    return this.push(new ProhibitsRule(fields));
  }
  /**
   * Exclude the field from the validated output.
   * Example: `rule().exclude()`
   */
  exclude(): this {
    return this.push(new ExcludeRule());
  }
  /**
   * Exclude the field when another field matches a value.
   * Example: `rule().excludeIf("draft", true)`
   */
  excludeIf(field: string, value: unknown): this {
    return this.push(new ExcludeIfRule(field, value));
  }
  /**
   * Exclude the field unless another field matches a value.
   * Example: `rule().excludeUnless("status", "published")`
   */
  excludeUnless(field: string, value: unknown): this {
    return this.push(new ExcludeUnlessRule(field, value));
  }
  /**
   * Exclude the field when any of the listed fields are present.
   * Example: `rule().excludeWith("removed_at")`
   */
  excludeWith(...fields: string[]): this {
    return this.push(new ExcludeWithRule(fields));
  }
  /**
   * Exclude the field when all of the listed fields are present.
   * Example: `rule().excludeWithout("first_name", "last_name")`
   */
  excludeWithout(...fields: string[]): this {
    return this.push(new ExcludeWithoutRule(fields));
  }

  // ── Type / coercion ────────────────────────────────────────
  /**
   * Cast the value to a string and validate it as text.
   * Example: `rule().string()`
   */
  string(): RuleBuilder<string, TPresence> {
    return this.push(new StringRule()) as any;
  }
  /**
   * Cast the value to an integer.
   * Example: `rule().integer()`
   */
  integer(): RuleBuilder<number, TPresence> {
    return this.push(new IntegerRule()) as any;
  }
  /**
   * Validate that the value is a number.
   * Example: `rule().number()`
   */
  number(): RuleBuilder<number, TPresence> {
    return this.push(new NumberRule()) as any;
  }
  /**
   * Validate numeric input and coerce it when possible.
   * Example: `rule().numeric()`
   */
  numeric(): RuleBuilder<number, TPresence> {
    return this.push(new NumericRule()) as any;
  }
  /**
   * Validate a decimal number with the given precision.
   * Example: `rule().decimal(2)`
   */
  decimal(min: number, max = min): this {
    return this.push(new DecimalRule(min, max));
  }
  /**
   * Require a fixed number of digits.
   * Example: `rule().digits(6)`
   */
  digits(n: number): this {
    return this.push(new DigitsRule(n));
  }
  /**
   * Require a digit length within a range.
   * Example: `rule().digitsBetween(4, 8)`
   */
  digitsBetween(min: number, max: number): this {
    return this.push(new DigitsBetweenRule(min, max));
  }
  /**
   * Require the value to be evenly divisible by `n`.
   * Example: `rule().multipleOf(5)`
   */
  multipleOf(n: number): this {
    return this.push(new MultipleOfRule(n));
  }
  /**
   * Validate boolean-like input.
   * Example: `rule().boolean()`
   */
  boolean(): RuleBuilder<boolean, TPresence> {
    return this.push(new BooleanRule()) as any;
  }
  /**
   * Validate an array value.
   * Example: `rule().array()`
   */
  array(): RuleBuilder<unknown[], TPresence>;
  /**
   * Validate an array and require the given keys when objects are nested.
   * Example: `rule().array(["id", "name"])`
   */
  array<const TKeys extends readonly string[]>(keys: TKeys): RuleBuilder<Partial<Record<TKeys[number], unknown>>, TPresence>;
  array(keys?: readonly string[]): any {
    return this.push(new ArrayRule(keys)) as any;
  }
  /**
   * Validate a list value.
   * Example: `rule().list()`
   */
  list(): RuleBuilder<unknown[], TPresence> {
    return this.push(new ListRule()) as any;
  }
  /**
   * Require the array to contain all listed values.
   * Example: `rule().contains(["admin", "owner"])`
   */
  contains(values: readonly unknown[]): this {
    return this.push(new ContainsRule(values));
  }
  /**
   * Require the array to omit all listed values.
   * Example: `rule().doesntContain(["draft"])`
   */
  doesntContain(values: readonly unknown[]): this {
    return this.push(new DoesntContainRule(values));
  }
  /**
   * Reject duplicate values in an array.
   * Example: `rule().distinct()`
   */
  distinct(): this {
    return this.push(new DistinctRule());
  }
  /**
   * Require the given keys to exist on an array value.
   * Example: `rule().requiredArrayKeys("id", "name")`
   */
  requiredArrayKeys(...keys: string[]): this {
    return this.push(new RequiredArrayKeysRule(keys));
  }
  /**
   * Validate that the value is a date.
   * Example: `rule().date()`
   */
  date(): RuleBuilder<Date, TPresence> {
    return this.push(new DateRule()) as any;
  }
  /**
   * Validate a date string with a specific format.
   * Example: `rule().dateFormat("YYYY-MM-DD")`
   */
  dateFormat(format: string): this {
    return this.push(new DateFormatRule(format));
  }
  /**
   * Require a date equal to another field or date value.
   * Example: `rule().dateEquals("published_at")`
   */
  dateEquals(other: string | Date): this {
    return this.push(new DateEqualsRule(other));
  }
  /**
   * Require a date after another field or date value.
   * Example: `rule().after("start_date")`
   */
  after(other: string | Date): this {
    return this.push(new DateComparisonRule("after", ">", other));
  }
  /**
   * Require a date after or equal to another field or date value.
   * Example: `rule().afterOrEqual("start_date")`
   */
  afterOrEqual(other: string | Date): this {
    return this.push(new DateComparisonRule("after_or_equal", ">=", other));
  }
  /**
   * Require a date before another field or date value.
   * Example: `rule().before("end_date")`
   */
  before(other: string | Date): this {
    return this.push(new DateComparisonRule("before", "<", other));
  }
  /**
   * Require a date before or equal to another field or date value.
   * Example: `rule().beforeOrEqual("end_date")`
   */
  beforeOrEqual(other: string | Date): this {
    return this.push(new DateComparisonRule("before_or_equal", "<=", other));
  }
  /**
   * Validate a timezone identifier.
   * Example: `rule().timezone()`
   */
  timezone(): this {
    return this.push(new TimezoneRule());
  }

  // ── Size ───────────────────────────────────────────────────
  /**
   * Require a minimum size, length, or numeric value.
   * Example: `rule().min(3)`
   */
  min(n: number): this {
    return this.push(new MinRule(n));
  }
  /**
   * Require a maximum size, length, or numeric value.
   * Example: `rule().max(10)`
   */
  max(n: number): this {
    return this.push(new MaxRule(n));
  }
  /**
   * Require a value to fall between two bounds.
   * Example: `rule().between(1, 5)`
   */
  between(a: number, b: number): this {
    return this.push(new BetweenRule(a, b));
  }
  /**
   * Require an exact size, length, or numeric value.
   * Example: `rule().size(12)`
   */
  size(n: number): this {
    return this.push(new SizeRule(n));
  }
  /**
   * Require a value greater than another value.
   * Example: `rule().gt(0)`
   */
  gt(other: number | string): this {
    return this.push(new ComparisonRule("gt", ">", other));
  }
  /**
   * Require a value greater than or equal to another value.
   * Example: `rule().gte(0)`
   */
  gte(other: number | string): this {
    return this.push(new ComparisonRule("gte", ">=", other));
  }
  /**
   * Require a value less than another value.
   * Example: `rule().lt(100)`
   */
  lt(other: number | string): this {
    return this.push(new ComparisonRule("lt", "<", other));
  }
  /**
   * Require a value less than or equal to another value.
   * Example: `rule().lte(100)`
   */
  lte(other: number | string): this {
    return this.push(new ComparisonRule("lte", "<=", other));
  }

  // ── Format ─────────────────────────────────────────────────
  /**
   * Validate an email address.
   * Example: `rule().email()`
   */
  email(): RuleBuilder<string, TPresence> {
    return this.push(new EmailRule()) as any;
  }
  /**
   * Validate a Philippine mobile number.
   * Example: `rule().phMobile()`
   */
  phMobile(): RuleBuilder<string, TPresence> {
    return this.push(new PhMobileRule()) as any;
  }
  /**
   * Validate a URL.
   * Example: `rule().url()`
   */
  url(): RuleBuilder<string, TPresence> {
    return this.push(new UrlRule()) as any;
  }
  /**
   * Validate a UUID string.
   * Example: `rule().uuid()`
   */
  uuid(): RuleBuilder<string, TPresence> {
    return this.push(new UuidRule()) as any;
  }
  /**
   * Validate a string with a regular expression.
   * Example: `rule().regex(/^[A-Z]+$/)`
   */
  regex(re: RegExp): RuleBuilder<string, TPresence> {
    return this.push(new RegexRule(re)) as any;
  }
  /**
   * Allow letters only.
   * Example: `rule().alpha()`
   */
  alpha(): RuleBuilder<string, TPresence> {
    return this.push(new AlphaRule()) as any;
  }
  /**
   * Allow letters and numbers only.
   * Example: `rule().alphaNum()`
   */
  alphaNum(): RuleBuilder<string, TPresence> {
    return this.push(new AlphaNumRule()) as any;
  }
  /**
   * Allow letters, numbers, dashes, and underscores.
   * Example: `rule().alphaDash()`
   */
  alphaDash(): RuleBuilder<string, TPresence> {
    return this.push(new AlphaDashRule()) as any;
  }
  /**
   * Allow ASCII text only.
   * Example: `rule().ascii()`
   */
  ascii(): RuleBuilder<string, TPresence> {
    return this.push(new AsciiRule()) as any;
  }
  /**
   * Require a prefix match.
   * Example: `rule().startsWith("https://")`
   */
  startsWith(...values: string[]): RuleBuilder<string, TPresence> {
    return this.push(new StartsWithRule(values)) as any;
  }
  /**
   * Require a suffix match.
   * Example: `rule().endsWith(".json")`
   */
  endsWith(...values: string[]): RuleBuilder<string, TPresence> {
    return this.push(new EndsWithRule(values)) as any;
  }
  /**
   * Reject values that start with the given prefixes.
   * Example: `rule().doesntStartWith("tmp_")`
   */
  doesntStartWith(...values: string[]): RuleBuilder<string, TPresence> {
    return this.push(new DoesntStartWithRule(values)) as any;
  }
  /**
   * Reject values that end with the given suffixes.
   * Example: `rule().doesntEndWith(".bak")`
   */
  doesntEndWith(...values: string[]): RuleBuilder<string, TPresence> {
    return this.push(new DoesntEndWithRule(values)) as any;
  }
  /**
   * Require lowercase text.
   * Example: `rule().lowercaseOnly()`
   */
  lowercaseOnly(): RuleBuilder<string, TPresence> {
    return this.push(new LowercaseValidationRule()) as any;
  }
  /**
   * Require uppercase text.
   * Example: `rule().uppercase()`
   */
  uppercase(): RuleBuilder<string, TPresence> {
    return this.push(new UppercaseRule()) as any;
  }
  /**
   * Validate a MAC address.
   * Example: `rule().macAddress()`
   */
  macAddress(): RuleBuilder<string, TPresence> {
    return this.push(new MacAddressRule()) as any;
  }
  /**
   * Validate an IP address.
   * Example: `rule().ip()`
   */
  ip(): RuleBuilder<string, TPresence> {
    return this.push(new IpRule()) as any;
  }
  /**
   * Validate an IPv4 address.
   * Example: `rule().ipv4()`
   */
  ipv4(): RuleBuilder<string, TPresence> {
    return this.push(new Ipv4Rule()) as any;
  }
  /**
   * Validate an IPv6 address.
   * Example: `rule().ipv6()`
   */
  ipv6(): RuleBuilder<string, TPresence> {
    return this.push(new Ipv6Rule()) as any;
  }
  /**
   * Validate a URL that resolves publicly.
   * Example: `rule().activeUrl()`
   */
  activeUrl(): RuleBuilder<string, TPresence> {
    return this.push(new ActiveUrlRule()) as any;
  }
  /**
   * Validate a ULID string.
   * Example: `rule().ulid()`
   */
  ulid(): RuleBuilder<string, TPresence> {
    return this.push(new UlidRule()) as any;
  }
  /**
   * Validate a hex color string.
   * Example: `rule().hexColor()`
   */
  hexColor(): RuleBuilder<string, TPresence> {
    return this.push(new HexColorRule()) as any;
  }
  /**
   * Restrict the value to one of the provided values.
   * Example: `rule().in(["draft", "published"] as const)`
   */
  in<const T extends readonly unknown[]>(values: T): RuleBuilder<T[number], TPresence> {
    return this.push(new InRule(values as readonly unknown[])) as any;
  }
  /**
   * Reject the value when it appears in the provided list.
   * Example: `rule().notIn(["tmp", "test"])`
   */
  notIn(values: readonly unknown[]): this {
    return this.push(new NotInRule(values));
  }

  // ── Cross-field ────────────────────────────────────────────
  /**
   * Require a confirmation field such as `password_confirmation`.
   * Example: `rule().confirmed()`
   */
  confirmed(): this {
    return this.push(new ConfirmedRule());
  }
  /**
   * Require the value to match another field.
   * Example: `rule().same("password")`
   */
  same(field: string): this {
    return this.push(new SameRule(field));
  }
  /**
   * Require the value to differ from another field.
   * Example: `rule().different("password")`
   */
  different(field: string): this {
    return this.push(new DifferentRule(field));
  }

  /**
   * Validate a file upload object.
   * Example: `rule().file()`
   */
  file(): RuleBuilder<ValidationFile, TPresence> {
    return this.push(new FileRule()) as any;
  }
  /**
   * Require the file to be an image.
   * Example: `rule().image()`
   */
  image(): RuleBuilder<ValidationFile, TPresence> {
    return this.push(new ImageRule()) as any;
  }
  /**
   * Restrict the file by extension.
   * Example: `rule().mimes("png", "jpg")`
   */
  mimes(...extensions: string[]): RuleBuilder<ValidationFile, TPresence> {
    return this.push(new MimesRule(extensions)) as any;
  }
  /**
   * Restrict the file by MIME type.
   * Example: `rule().mimeTypes("image/png")`
   */
  mimeTypes(...types: string[]): RuleBuilder<ValidationFile, TPresence> {
    return this.push(new MimeTypesRule(types)) as any;
  }
  /**
   * Restrict the file by extension list.
   * Example: `rule().extensions("pdf", "docx")`
   */
  extensions(...extensions: string[]): RuleBuilder<ValidationFile, TPresence> {
    return this.push(new ExtensionsRule(extensions)) as any;
  }
  /**
   * Validate file dimensions and aspect ratio.
   * Example: `rule().dimensions({ width: 1200, height: 800 })`
   */
  dimensions(options: { width?: number; height?: number; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; ratio?: number }): RuleBuilder<ValidationFile, TPresence> {
    return this.push(new DimensionsRule(options)) as any;
  }
  /**
   * Validate against a map-like enum object.
   * Example: `rule().enum(Status)`
   */
  enum<const TValues extends Record<string, unknown>>(values: TValues): RuleBuilder<TValues[keyof TValues], TPresence> {
    return this.push(new EnumRule(values)) as any;
  }
  /**
   * Accept if any of the provided rule chains passes.
   * Example: `rule().anyOf(rule().email(), rule().url())`
   */
  anyOf<const TBuilders extends readonly RuleBuilder<any, any>[]>(
    ...builders: TBuilders
  ): RuleBuilder<AnyOfValue<TValue, TBuilders>, TPresence> {
    return this.push(new AnyOfRule(builders.map((builder) => builder.specs))) as any;
  }
  /**
   * Run a custom boolean predicate against the value.
   * Example: `rule().can((value) => value !== "")`
   */
  can(callback: (value: unknown, ctx: any) => boolean | Promise<boolean>): this {
    return this.push(new CanRule(callback));
  }
  /**
   * Attach a custom rule contract.
   * Example: `rule().use(myRule)`
   */
  use(customRule: RuleContract): this {
    return this.push(customRule);
  }
  /**
   * Define an inline custom rule.
   * Example: `rule().custom("slug", (value) => /^[a-z0-9-]+$/.test(String(value)))`
   */
  custom(
    name: string,
    validate: (value: unknown, ctx: any) => boolean | Promise<boolean>,
    message?: string | ((ctx: any) => string),
  ): this {
    return this.push(new CustomRule(name, validate, message));
  }
  /**
   * Validate a password using the built-in password rule set.
   * Example: `rule().password((r) => r.min(12).letters().numbers())`
   */
  password(configure?: (rule: PasswordRule) => PasswordRule | void): this {
    const password = new PasswordRule();
    configure?.(password);
    return this.push(password);
  }

  // ── DB-aware (async) ───────────────────────────────────────
  /**
   * Require a unique value in the given table and column.
   * Example: `rule().unique("users", "email")`
   */
  unique(table: string, column?: string): this {
    return this.push(new UniqueRule(table, column));
  }
  /**
   * Require the value to exist in the given table and column.
   * Example: `rule().exists("users", "id")`
   */
  exists(table: string, column?: string): this {
    return this.push(new ExistsRule(table, column));
  }
  /**
   * Add an extra where clause to the most recent DB-backed rule.
   * Example: `rule().unique("users", "email").where("tenant_id", 1)`
   */
  where(column: string, value: unknown): this {
    this.last<any>("where")?.where(column, value);
    return this;
  }
  /**
   * Add a negated where clause to the most recent DB-backed rule.
   * Example: `rule().unique("users", "email").whereNot("id", 10)`
   */
  whereNot(column: string, value: unknown): this {
    this.last<any>("whereNot")?.whereNot(column, value);
    return this;
  }
  /**
   * Restrict the most recent DB-backed rule to rows where a column is null.
   * Example: `rule().unique("users", "email").whereNull("deleted_at")`
   */
  whereNull(column: string): this {
    this.last<any>("whereNull")?.whereNull(column);
    return this;
  }
  /**
   * Restrict the most recent DB-backed rule to rows where a column is not null.
   * Example: `rule().unique("users", "email").whereNotNull("deleted_at")`
   */
  whereNotNull(column: string): this {
    this.last<any>("whereNotNull")?.whereNotNull(column);
    return this;
  }
  /**
   * Ignore a record ID when checking uniqueness.
   * Example: `rule().unique("users", "email").ignore(userId)`
   */
  ignore(id: unknown, column?: string): this {
    this.last<any>("ignore")?.ignore(id, column);
    return this;
  }
  /**
   * Ignore the current record using another field value.
   * Example: `rule().unique("users", "email").ignoreField("id")`
   */
  ignoreField(field: string, column?: string): this {
    this.last<any>("ignoreField")?.ignoreField(field, column);
    return this;
  }
  /**
   * Exclude soft-deleted rows from the DB-backed rule.
   * Example: `rule().unique("users", "email").withoutTrashed()`
   */
  withoutTrashed(column?: string): this {
    this.last<any>("withoutTrashed")?.withoutTrashed(column);
    return this;
  }

  // ── Transform / default ────────────────────────────────────
  /**
   * Apply a default value when the field is missing.
   * Example: `rule().default("draft")`
   */
  default<const TDefault>(value: TDefault): RuleBuilder<Defaulted<TValue, TDefault>, "required"> {
    return this.push(new DefaultRule(value)) as any;
  }
  /**
   * Trim surrounding whitespace from a string value.
   * Example: `rule().trim()`
   */
  trim(): this {
    return this.push(new TrimRule());
  }
  /**
   * Convert a string value to lowercase.
   * Example: `rule().lowercase()`
   */
  lowercase(): this {
    return this.push(new LowercaseRule());
  }
  /**
   * Conditionally apply rules when a predicate is true.
   * Example: `rule().when(isAdmin, (r) => r.required())`
   */
  when(condition: boolean, callback: (rule: this) => this | void): this {
    if (condition) callback(this);
    return this;
  }
  /**
   * Conditionally apply rules when a predicate is false.
   * Example: `rule().unless(isAdmin, (r) => r.required())`
   */
  unless(condition: boolean, callback: (rule: this) => this | void): this {
    if (!condition) callback(this);
    return this;
  }
}

/**
 * Start a new rule chain.
 * Example: `rule().required().email()`
 */
export function rule(): RuleBuilder {
  return new RuleBuilder();
}

// ── Schema → output type inference ───────────────────────────

export type ValidationSchema = Record<string, RuleBuilder<any, any>>;

type ValueOf<B> = B extends RuleBuilder<infer V, any> ? V : never;
type PresenceOf<B> = B extends RuleBuilder<any, infer P> ? P : "required";
type ValueOfBuilders<T extends readonly RuleBuilder<any, any>[]> = ValueOf<T[number]>;
type AnyOfValue<TCurrent, TBuilders extends readonly RuleBuilder<any, any>[]> =
  unknown extends TCurrent ? ValueOfBuilders<TBuilders> : TCurrent | ValueOfBuilders<TBuilders>;

type Simplify<T> = { [K in keyof T]: T[K] };
type UnionToIntersection<U> =
  (U extends any ? (value: U) => 0 : never) extends (value: infer I) => 0 ? I : never;
type IntersectFromUnion<U> = [U] extends [never] ? {} : UnionToIntersection<U>;
type WildcardPrefix<K extends string> = K extends `${infer Prefix}.*.${string}` ? Prefix : never;
type WildcardPrefixes<S extends ValidationSchema> = WildcardPrefix<Extract<keyof S, string>>;
type DirectSchemaKey<K extends string, P extends string> = K extends `${string}*${string}` ? never : K extends P ? never : K;
type DirectSchemaKeys<S extends ValidationSchema> = Extract<keyof S, string> extends infer K
  ? K extends string
    ? DirectSchemaKey<K, WildcardPrefixes<S>>
    : never
  : never;
type PathObject<Path extends string, V, Optional extends boolean> =
  Path extends `${infer Head}.${infer Tail}`
    ? Optional extends true
      ? { [K in Head]?: PathObject<Tail, V, Optional> }
      : { [K in Head]: PathObject<Tail, V, Optional> }
    : Optional extends true
      ? { [K in Path]?: V }
      : { [K in Path]: V };
type SchemaEntryOutput<K extends string, B extends RuleBuilder<any, any>> = PathObject<K, ValueOf<B>, PresenceOf<B> extends "optional" ? true : false>;
type DirectSchemaOutput<S extends ValidationSchema> = Simplify<IntersectFromUnion<{
  [K in DirectSchemaKeys<S>]: SchemaEntryOutput<K, S[K]>;
}[DirectSchemaKeys<S>]>>;
type WildcardChildSchema<S extends ValidationSchema, P extends string> = {
  [K in keyof S as K extends `${P}.*.${infer Rest}` ? Rest : never]: S[K];
};
type WildcardGroupOutput<S extends ValidationSchema, P extends string> =
  P extends keyof S
    ? PresenceOf<S[P]> extends "optional"
      ? { [K in P]?: Array<InferOutputFromSchema<WildcardChildSchema<S, P>>> }
      : { [K in P]: Array<InferOutputFromSchema<WildcardChildSchema<S, P>>> }
    : { [K in P]?: Array<InferOutputFromSchema<WildcardChildSchema<S, P>>> };
type WildcardSchemaOutput<S extends ValidationSchema> = Simplify<IntersectFromUnion<{
  [P in WildcardPrefixes<S>]: WildcardGroupOutput<S, P>;
}[WildcardPrefixes<S>]>>;
type InferOutputFromSchema<S extends ValidationSchema> = Simplify<DirectSchemaOutput<S> & WildcardSchemaOutput<S>>;

export type InferOutput<T> =
  T extends { readonly entries: infer S extends ValidationSchema }
    ? InferOutputFromSchema<S>
    : T extends ValidationSchema
      ? InferOutputFromSchema<T>
      : never;
