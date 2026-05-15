import type { RuleContract } from "./types.js";
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

  private last<T extends Record<string, unknown>>(method: keyof T): T | undefined {
    const rule = this.specs[this.specs.length - 1] as unknown as T | undefined;
    return rule && typeof rule[method] === "function" ? rule : undefined;
  }

  // ── Presence ───────────────────────────────────────────────
  required(): RuleBuilder<TValue, "required"> {
    return this.push(new RequiredRule()) as any;
  }
  nullable(): RuleBuilder<TValue | null, TPresence> {
    return this.push(new NullableRule()) as any;
  }
  sometimes(): RuleBuilder<TValue, "optional"> {
    return this.push(new SometimesRule()) as any;
  }
  filled(): this {
    return this.push(new FilledRule());
  }
  requiredIf(field: string, value: unknown): this {
    return this.push(new RequiredIfRule(field, value));
  }
  requiredWith(field: string): this {
    return this.push(new RequiredWithRule(field));
  }
  accepted(): this {
    return this.push(new AcceptedRule());
  }
  acceptedIf(field: string, value: unknown): this {
    return this.push(new AcceptedIfRule(field, value));
  }
  declined(): this {
    return this.push(new DeclinedRule());
  }
  declinedIf(field: string, value: unknown): this {
    return this.push(new DeclinedIfRule(field, value));
  }
  requiredUnless(field: string, value: unknown): this {
    return this.push(new RequiredUnlessRule(field, value));
  }
  requiredWithAll(...fields: string[]): this {
    return this.push(new RequiredWithAllRule(fields));
  }
  requiredWithout(...fields: string[]): this {
    return this.push(new RequiredWithoutRule(fields));
  }
  requiredWithoutAll(...fields: string[]): this {
    return this.push(new RequiredWithoutAllRule(fields));
  }
  present(): this {
    return this.push(new PresentRule());
  }
  presentIf(field: string, value: unknown): this {
    return this.push(new PresentIfRule(field, value));
  }
  presentUnless(field: string, value: unknown): this {
    return this.push(new PresentUnlessRule(field, value));
  }
  presentWith(...fields: string[]): this {
    return this.push(new PresentWithRule(fields));
  }
  presentWithAll(...fields: string[]): this {
    return this.push(new PresentWithAllRule(fields));
  }
  missing(): this {
    return this.push(new MissingRule());
  }
  missingIf(field: string, value: unknown): this {
    return this.push(new MissingIfRule(field, value));
  }
  missingUnless(field: string, value: unknown): this {
    return this.push(new MissingUnlessRule(field, value));
  }
  missingWith(...fields: string[]): this {
    return this.push(new MissingWithRule(fields));
  }
  missingWithAll(...fields: string[]): this {
    return this.push(new MissingWithAllRule(fields));
  }
  prohibited(): this {
    return this.push(new ProhibitedRule());
  }
  prohibitedIf(field: string, value: unknown): this {
    return this.push(new ProhibitedIfRule(field, value));
  }
  prohibitedUnless(field: string, value: unknown): this {
    return this.push(new ProhibitedUnlessRule(field, value));
  }
  prohibits(...fields: string[]): this {
    return this.push(new ProhibitsRule(fields));
  }
  exclude(): this {
    return this.push(new ExcludeRule());
  }
  excludeIf(field: string, value: unknown): this {
    return this.push(new ExcludeIfRule(field, value));
  }
  excludeUnless(field: string, value: unknown): this {
    return this.push(new ExcludeUnlessRule(field, value));
  }
  excludeWith(...fields: string[]): this {
    return this.push(new ExcludeWithRule(fields));
  }
  excludeWithout(...fields: string[]): this {
    return this.push(new ExcludeWithoutRule(fields));
  }

  // ── Type / coercion ────────────────────────────────────────
  string(): RuleBuilder<string, TPresence> {
    return this.push(new StringRule()) as any;
  }
  integer(): RuleBuilder<number, TPresence> {
    return this.push(new IntegerRule()) as any;
  }
  number(): RuleBuilder<number, TPresence> {
    return this.push(new NumberRule()) as any;
  }
  numeric(): RuleBuilder<number, TPresence> {
    return this.push(new NumericRule()) as any;
  }
  decimal(min: number, max = min): this {
    return this.push(new DecimalRule(min, max));
  }
  digits(n: number): this {
    return this.push(new DigitsRule(n));
  }
  digitsBetween(min: number, max: number): this {
    return this.push(new DigitsBetweenRule(min, max));
  }
  multipleOf(n: number): this {
    return this.push(new MultipleOfRule(n));
  }
  boolean(): RuleBuilder<boolean, TPresence> {
    return this.push(new BooleanRule()) as any;
  }
  array(keys?: readonly string[]): RuleBuilder<unknown[], TPresence> {
    return this.push(new ArrayRule(keys)) as any;
  }
  list(): RuleBuilder<unknown[], TPresence> {
    return this.push(new ListRule()) as any;
  }
  contains(values: readonly unknown[]): this {
    return this.push(new ContainsRule(values));
  }
  doesntContain(values: readonly unknown[]): this {
    return this.push(new DoesntContainRule(values));
  }
  distinct(): this {
    return this.push(new DistinctRule());
  }
  requiredArrayKeys(...keys: string[]): this {
    return this.push(new RequiredArrayKeysRule(keys));
  }
  date(): RuleBuilder<Date, TPresence> {
    return this.push(new DateRule()) as any;
  }
  dateFormat(format: string): this {
    return this.push(new DateFormatRule(format));
  }
  dateEquals(other: string | Date): this {
    return this.push(new DateEqualsRule(other));
  }
  after(other: string | Date): this {
    return this.push(new DateComparisonRule("after", ">", other));
  }
  afterOrEqual(other: string | Date): this {
    return this.push(new DateComparisonRule("after_or_equal", ">=", other));
  }
  before(other: string | Date): this {
    return this.push(new DateComparisonRule("before", "<", other));
  }
  beforeOrEqual(other: string | Date): this {
    return this.push(new DateComparisonRule("before_or_equal", "<=", other));
  }
  timezone(): this {
    return this.push(new TimezoneRule());
  }

  // ── Size ───────────────────────────────────────────────────
  min(n: number): this {
    return this.push(new MinRule(n));
  }
  max(n: number): this {
    return this.push(new MaxRule(n));
  }
  between(a: number, b: number): this {
    return this.push(new BetweenRule(a, b));
  }
  size(n: number): this {
    return this.push(new SizeRule(n));
  }
  gt(other: number | string): this {
    return this.push(new ComparisonRule("gt", ">", other));
  }
  gte(other: number | string): this {
    return this.push(new ComparisonRule("gte", ">=", other));
  }
  lt(other: number | string): this {
    return this.push(new ComparisonRule("lt", "<", other));
  }
  lte(other: number | string): this {
    return this.push(new ComparisonRule("lte", "<=", other));
  }

  // ── Format ─────────────────────────────────────────────────
  email(): this {
    return this.push(new EmailRule());
  }
  url(): this {
    return this.push(new UrlRule());
  }
  uuid(): this {
    return this.push(new UuidRule());
  }
  regex(re: RegExp): this {
    return this.push(new RegexRule(re));
  }
  alpha(): this {
    return this.push(new AlphaRule());
  }
  alphaNum(): this {
    return this.push(new AlphaNumRule());
  }
  alphaDash(): this {
    return this.push(new AlphaDashRule());
  }
  ascii(): this {
    return this.push(new AsciiRule());
  }
  startsWith(...values: string[]): this {
    return this.push(new StartsWithRule(values));
  }
  endsWith(...values: string[]): this {
    return this.push(new EndsWithRule(values));
  }
  doesntStartWith(...values: string[]): this {
    return this.push(new DoesntStartWithRule(values));
  }
  doesntEndWith(...values: string[]): this {
    return this.push(new DoesntEndWithRule(values));
  }
  lowercaseOnly(): this {
    return this.push(new LowercaseValidationRule());
  }
  uppercase(): this {
    return this.push(new UppercaseRule());
  }
  macAddress(): this {
    return this.push(new MacAddressRule());
  }
  ip(): this {
    return this.push(new IpRule());
  }
  ipv4(): this {
    return this.push(new Ipv4Rule());
  }
  ipv6(): this {
    return this.push(new Ipv6Rule());
  }
  activeUrl(): this {
    return this.push(new ActiveUrlRule());
  }
  ulid(): this {
    return this.push(new UlidRule());
  }
  hexColor(): this {
    return this.push(new HexColorRule());
  }
  in<const T extends readonly unknown[]>(values: T): RuleBuilder<T[number], TPresence> {
    return this.push(new InRule(values as readonly unknown[])) as any;
  }
  notIn(values: readonly unknown[]): this {
    return this.push(new NotInRule(values));
  }

  // ── Cross-field ────────────────────────────────────────────
  confirmed(): this {
    return this.push(new ConfirmedRule());
  }
  same(field: string): this {
    return this.push(new SameRule(field));
  }
  different(field: string): this {
    return this.push(new DifferentRule(field));
  }

  file(): this {
    return this.push(new FileRule());
  }
  image(): this {
    return this.push(new ImageRule());
  }
  mimes(...extensions: string[]): this {
    return this.push(new MimesRule(extensions));
  }
  mimeTypes(...types: string[]): this {
    return this.push(new MimeTypesRule(types));
  }
  extensions(...extensions: string[]): this {
    return this.push(new ExtensionsRule(extensions));
  }
  dimensions(options: { width?: number; height?: number; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; ratio?: number }): this {
    return this.push(new DimensionsRule(options));
  }
  enum(values: Record<string, unknown>): this {
    return this.push(new EnumRule(values));
  }
  anyOf(...builders: RuleBuilder<any, any>[]): this {
    return this.push(new AnyOfRule(builders.map((builder) => builder.specs)));
  }
  can(callback: (value: unknown, ctx: any) => boolean | Promise<boolean>): this {
    return this.push(new CanRule(callback));
  }
  use(customRule: RuleContract): this {
    return this.push(customRule);
  }
  custom(
    name: string,
    validate: (value: unknown, ctx: any) => boolean | Promise<boolean>,
    message?: string | ((ctx: any) => string),
  ): this {
    return this.push(new CustomRule(name, validate, message));
  }
  password(configure?: (rule: PasswordRule) => PasswordRule | void): this {
    const password = new PasswordRule();
    configure?.(password);
    return this.push(password);
  }

  // ── DB-aware (async) ───────────────────────────────────────
  unique(table: string, column?: string): this {
    return this.push(new UniqueRule(table, column));
  }
  exists(table: string, column?: string): this {
    return this.push(new ExistsRule(table, column));
  }
  where(column: string, value: unknown): this {
    this.last<any>("where")?.where(column, value);
    return this;
  }
  whereNot(column: string, value: unknown): this {
    this.last<any>("whereNot")?.whereNot(column, value);
    return this;
  }
  whereNull(column: string): this {
    this.last<any>("whereNull")?.whereNull(column);
    return this;
  }
  whereNotNull(column: string): this {
    this.last<any>("whereNotNull")?.whereNotNull(column);
    return this;
  }
  ignore(id: unknown, column?: string): this {
    this.last<any>("ignore")?.ignore(id, column);
    return this;
  }
  withoutTrashed(column?: string): this {
    this.last<any>("withoutTrashed")?.withoutTrashed(column);
    return this;
  }

  // ── Transform / default ────────────────────────────────────
  default<const TDefault>(value: TDefault): RuleBuilder<Defaulted<TValue, TDefault>, "required"> {
    return this.push(new DefaultRule(value)) as any;
  }
  trim(): this {
    return this.push(new TrimRule());
  }
  lowercase(): this {
    return this.push(new LowercaseRule());
  }
  when(condition: boolean, callback: (rule: this) => this | void): this {
    if (condition) callback(this);
    return this;
  }
  unless(condition: boolean, callback: (rule: this) => this | void): this {
    if (!condition) callback(this);
    return this;
  }
}

/** Start a new rule chain. */
export function rule(): RuleBuilder {
  return new RuleBuilder();
}

// ── Schema → output type inference ───────────────────────────

export type ValidationSchema = Record<string, RuleBuilder<any, any>>;

type ValueOf<B> = B extends RuleBuilder<infer V, any> ? V : never;
type PresenceOf<B> = B extends RuleBuilder<any, infer P> ? P : "required";

export type InferOutput<S extends ValidationSchema> =
  // required keys
  {
    [K in keyof S as PresenceOf<S[K]> extends "required" ? K : never]: ValueOf<S[K]>;
  } & {
    // optional keys
    [K in keyof S as PresenceOf<S[K]> extends "optional" ? K : never]?: ValueOf<S[K]>;
  } extends infer O
    ? { [K in keyof O]: O[K] }
    : never;
