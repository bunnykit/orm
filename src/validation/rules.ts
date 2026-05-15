import type { RuleContract, RuleResult, ValidationContext } from "./types.js";

function isAbsent(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

const PASS: RuleResult = true;
const SKIP: RuleResult = { pass: true, skip: true };
const EXCLUDE: RuleResult & { exclude: true } = { pass: true, exclude: true };

function valuesEqual(a: unknown, b: unknown): boolean {
  return a === b || String(a) === String(b);
}

function valueMatches(actual: unknown, expected: unknown): boolean {
  return Array.isArray(expected)
    ? expected.some((value) => valuesEqual(actual, value))
    : valuesEqual(actual, expected);
}

function anyPresent(c: ValidationContext, fields: readonly string[]): boolean {
  return fields.some((field) => !isAbsent(c.get(field)));
}

function allPresent(c: ValidationContext, fields: readonly string[]): boolean {
  return fields.every((field) => !isAbsent(c.get(field)));
}

function anyMissing(c: ValidationContext, fields: readonly string[]): boolean {
  return fields.some((field) => isAbsent(c.get(field)));
}

function compareDate(value: unknown, other: unknown): number | undefined {
  const left = value instanceof Date ? value : new Date(value as any);
  const right = other instanceof Date ? other : new Date(other as any);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return undefined;
  return left.getTime() - right.getTime();
}

function fileName(v: unknown): string | undefined {
  return typeof (v as any)?.name === "string" ? (v as any).name : undefined;
}

function fileType(v: unknown): string | undefined {
  return typeof (v as any)?.type === "string" ? (v as any).type : undefined;
}

function fileSize(v: unknown): number | undefined {
  return typeof (v as any)?.size === "number" ? (v as any).size : undefined;
}

function collectWildcardValues(data: Record<string, any>, pattern: string): unknown[] {
  const parts = pattern.split(".").filter(Boolean);
  const values: unknown[] = [];
  const visit = (value: unknown, index: number) => {
    if (index === parts.length) {
      values.push(value);
      return;
    }
    const part = parts[index];
    if (part === "*") {
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, index + 1));
      } else if (value && typeof value === "object") {
        Object.values(value).forEach((item) => visit(item, index + 1));
      }
      return;
    }
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, part)) {
      visit((value as Record<string, unknown>)[part], index + 1);
    }
  };
  visit(data, 0);
  return values;
}

// ── Presence ─────────────────────────────────────────────────

export class RequiredRule implements RuleContract {
  name = "required";
  validate(v: unknown) {
    if (Array.isArray(v)) return v.length > 0;
    return !isAbsent(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is required.`;
  }
}

export class NullableRule implements RuleContract {
  name = "nullable";
  validate(v: unknown, _c?: ValidationContext): RuleResult {
    return v === undefined || v === null ? SKIP : PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is invalid.`;
  }
}

export class SometimesRule implements RuleContract {
  name = "sometimes";
  validate(v: unknown, _c?: ValidationContext): RuleResult {
    return v === undefined ? SKIP : PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is invalid.`;
  }
}

export class FilledRule implements RuleContract {
  name = "filled";
  validate(v: unknown, _c?: ValidationContext): RuleResult {
    if (v === undefined) return SKIP;
    return !isAbsent(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must not be empty.`;
  }
}

export class RequiredIfRule implements RuleContract {
  name = "required_if";
  constructor(private field: string, private value: unknown) {}
  validate(v: unknown, c: ValidationContext): RuleResult {
    if (valueMatches(c.get(this.field), this.value)) return !isAbsent(v);
    if (isAbsent(v)) return SKIP;
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is required when ${this.field} is ${String(this.value)}.`;
  }
}

export class RequiredWithRule implements RuleContract {
  name = "required_with";
  constructor(private field: string) {}
  validate(v: unknown, c: ValidationContext): RuleResult {
    if (!isAbsent(c.get(this.field))) return !isAbsent(v);
    if (isAbsent(v)) return SKIP;
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is required when ${this.field} is present.`;
  }
}

export class AcceptedRule implements RuleContract {
  name = "accepted";
  validate(v: unknown, _c?: ValidationContext): RuleResult {
    return v === true || v === "yes" || v === "on" || v === 1 || v === "1";
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be accepted.`;
  }
}

export class AcceptedIfRule extends AcceptedRule {
  name = "accepted_if";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return valueMatches(c.get(this.field), this.value) ? super.validate(v) : PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be accepted when ${this.field} is ${String(this.value)}.`;
  }
}

export class DeclinedRule implements RuleContract {
  name = "declined";
  validate(v: unknown, _c?: ValidationContext): RuleResult {
    return v === false || v === "no" || v === "off" || v === 0 || v === "0";
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be declined.`;
  }
}

export class DeclinedIfRule extends DeclinedRule {
  name = "declined_if";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return valueMatches(c.get(this.field), this.value) ? super.validate(v) : PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be declined when ${this.field} is ${String(this.value)}.`;
  }
}

export class RequiredUnlessRule implements RuleContract {
  name = "required_unless";
  constructor(private field: string, private value: unknown) {}
  validate(v: unknown, c: ValidationContext): RuleResult {
    if (!valueMatches(c.get(this.field), this.value)) return !isAbsent(v);
    if (isAbsent(v)) return SKIP;
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is required unless ${this.field} is ${String(this.value)}.`;
  }
}

export class RequiredWithAllRule implements RuleContract {
  name = "required_with_all";
  constructor(private fields: readonly string[]) {}
  validate(v: unknown, c: ValidationContext): RuleResult {
    if (allPresent(c, this.fields)) return !isAbsent(v);
    if (isAbsent(v)) return SKIP;
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is required when all related fields are present.`;
  }
}

export class RequiredWithoutRule implements RuleContract {
  name = "required_without";
  constructor(private fields: readonly string[]) {}
  validate(v: unknown, c: ValidationContext): RuleResult {
    if (anyMissing(c, this.fields)) return !isAbsent(v);
    if (isAbsent(v)) return SKIP;
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is required when a related field is missing.`;
  }
}

export class RequiredWithoutAllRule implements RuleContract {
  name = "required_without_all";
  constructor(private fields: readonly string[]) {}
  validate(v: unknown, c: ValidationContext): RuleResult {
    if (this.fields.every((field) => isAbsent(c.get(field)))) return !isAbsent(v);
    if (isAbsent(v)) return SKIP;
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is required when all related fields are missing.`;
  }
}

export class PresentRule implements RuleContract {
  name = "present";
  validate(_v: unknown, c: ValidationContext): RuleResult {
    return c.has(c.attribute);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be present.`;
  }
}

export class PresentIfRule extends PresentRule {
  name = "present_if";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return valueMatches(c.get(this.field), this.value) ? super.validate(v, c) : PASS;
  }
}

export class PresentUnlessRule extends PresentRule {
  name = "present_unless";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return !valueMatches(c.get(this.field), this.value) ? super.validate(v, c) : PASS;
  }
}

export class PresentWithRule extends PresentRule {
  name = "present_with";
  constructor(private fields: readonly string[]) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return anyPresent(c, this.fields) ? super.validate(v, c) : PASS;
  }
}

export class PresentWithAllRule extends PresentRule {
  name = "present_with_all";
  constructor(private fields: readonly string[]) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return allPresent(c, this.fields) ? super.validate(v, c) : PASS;
  }
}

export class MissingRule implements RuleContract {
  name = "missing";
  validate(_v: unknown, c: ValidationContext): RuleResult {
    return !c.has(c.attribute);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be missing.`;
  }
}

export class MissingIfRule extends MissingRule {
  name = "missing_if";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return valueMatches(c.get(this.field), this.value) ? super.validate(v, c) : PASS;
  }
}

export class MissingUnlessRule extends MissingRule {
  name = "missing_unless";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return !valueMatches(c.get(this.field), this.value) ? super.validate(v, c) : PASS;
  }
}

export class MissingWithRule extends MissingRule {
  name = "missing_with";
  constructor(private fields: readonly string[]) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return anyPresent(c, this.fields) ? super.validate(v, c) : PASS;
  }
}

export class MissingWithAllRule extends MissingRule {
  name = "missing_with_all";
  constructor(private fields: readonly string[]) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return allPresent(c, this.fields) ? super.validate(v, c) : PASS;
  }
}

export class ProhibitedRule implements RuleContract {
  name = "prohibited";
  validate(v: unknown, _c?: ValidationContext): RuleResult {
    return isAbsent(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is prohibited.`;
  }
}

export class ProhibitedIfRule extends ProhibitedRule {
  name = "prohibited_if";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return valueMatches(c.get(this.field), this.value) ? super.validate(v, c) : PASS;
  }
}

export class ProhibitedUnlessRule extends ProhibitedRule {
  name = "prohibited_unless";
  constructor(private field: string, private value: unknown) { super(); }
  validate(v: unknown, c: ValidationContext): RuleResult {
    return !valueMatches(c.get(this.field), this.value) ? super.validate(v, c) : PASS;
  }
}

export class ProhibitsRule implements RuleContract {
  name = "prohibits";
  constructor(private fields: readonly string[]) {}
  validate(v: unknown, c: ValidationContext): RuleResult {
    if (isAbsent(v)) return PASS;
    return this.fields.every((field) => isAbsent(c.get(field)));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field prohibits another field from being present.`;
  }
}

export class ExcludeRule implements RuleContract {
  name = "exclude";
  validate(_v?: unknown, _c?: ValidationContext): RuleResult {
    return EXCLUDE;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is invalid.`;
  }
}

export class ExcludeIfRule extends ExcludeRule {
  name = "exclude_if";
  constructor(private field: string, private value: unknown) { super(); }
  validate(_v: unknown, c: ValidationContext): RuleResult {
    return valueMatches(c.get(this.field), this.value) ? EXCLUDE : PASS;
  }
}

export class ExcludeUnlessRule extends ExcludeRule {
  name = "exclude_unless";
  constructor(private field: string, private value: unknown) { super(); }
  validate(_v: unknown, c: ValidationContext): RuleResult {
    return !valueMatches(c.get(this.field), this.value) ? EXCLUDE : PASS;
  }
}

export class ExcludeWithRule extends ExcludeRule {
  name = "exclude_with";
  constructor(private fields: readonly string[]) { super(); }
  validate(_v: unknown, c: ValidationContext): RuleResult {
    return anyPresent(c, this.fields) ? EXCLUDE : PASS;
  }
}

export class ExcludeWithoutRule extends ExcludeRule {
  name = "exclude_without";
  constructor(private fields: readonly string[]) { super(); }
  validate(_v: unknown, c: ValidationContext): RuleResult {
    return anyMissing(c, this.fields) ? EXCLUDE : PASS;
  }
}

// ── Type / coercion ──────────────────────────────────────────

export class StringRule implements RuleContract {
  name = "string";
  validate(v: unknown) {
    return typeof v === "string";
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a string.`;
  }
}

export class IntegerRule implements RuleContract {
  name = "integer";
  coerce(v: unknown) {
    if (typeof v === "string" && v.trim() !== "" && Number.isInteger(Number(v))) {
      return Number(v);
    }
    return v;
  }
  validate(v: unknown) {
    return typeof v === "number" && Number.isInteger(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be an integer.`;
  }
}

export class NumberRule implements RuleContract {
  name = "number";
  coerce(v: unknown) {
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
    return v;
  }
  validate(v: unknown) {
    return typeof v === "number" && !Number.isNaN(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a number.`;
  }
}

export class NumericRule extends NumberRule {
  name = "numeric";
}

export class DecimalRule implements RuleContract {
  name = "decimal";
  constructor(private min: number, private max = min) {}
  validate(v: unknown) {
    if (typeof v !== "number" && typeof v !== "string") return false;
    const text = String(v);
    if (!/^-?\d+\.\d+$/.test(text)) return false;
    const decimals = text.split(".")[1]?.length ?? 0;
    return decimals >= this.min && decimals <= this.max;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must have between ${this.min} and ${this.max} decimal places.`;
  }
}

export class DigitsRule implements RuleContract {
  name = "digits";
  constructor(private n: number) {}
  validate(v: unknown) {
    return new RegExp(`^\\d{${this.n}}$`).test(String(v));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be ${this.n} digits.`;
  }
}

export class DigitsBetweenRule implements RuleContract {
  name = "digits_between";
  constructor(private min: number, private max: number) {}
  validate(v: unknown) {
    return new RegExp(`^\\d{${this.min},${this.max}}$`).test(String(v));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be between ${this.min} and ${this.max} digits.`;
  }
}

export class MultipleOfRule implements RuleContract {
  name = "multiple_of";
  constructor(private n: number) {}
  validate(v: unknown) {
    return typeof v === "number" && v % this.n === 0;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a multiple of ${this.n}.`;
  }
}

export class BooleanRule implements RuleContract {
  name = "boolean";
  coerce(v: unknown) {
    if (v === "true" || v === 1 || v === "1") return true;
    if (v === "false" || v === 0 || v === "0") return false;
    return v;
  }
  validate(v: unknown) {
    return typeof v === "boolean";
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be true or false.`;
  }
}

export class ArrayRule implements RuleContract {
  name = "array";
  constructor(private keys?: readonly string[]) {}
  validate(v: unknown) {
    if (!Array.isArray(v) && (v === null || typeof v !== "object")) return false;
    if (!this.keys?.length || v === null || typeof v !== "object") return Array.isArray(v);
    return Object.keys(v).every((key) => this.keys!.includes(key));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be an array.`;
  }
}

export class ListRule implements RuleContract {
  name = "list";
  validate(v: unknown) {
    return Array.isArray(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a list.`;
  }
}

export class ContainsRule implements RuleContract {
  name = "contains";
  constructor(private values: readonly unknown[]) {}
  validate(v: unknown) {
    return Array.isArray(v) && this.values.every((value) => v.includes(value));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must contain the required values.`;
  }
}

export class DoesntContainRule implements RuleContract {
  name = "doesnt_contain";
  constructor(private values: readonly unknown[]) {}
  validate(v: unknown) {
    return Array.isArray(v) && this.values.every((value) => !v.includes(value));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must not contain prohibited values.`;
  }
}

export class DistinctRule implements RuleContract {
  name = "distinct";
  validate(v: unknown, c: ValidationContext) {
    if (!c.pattern.includes("*")) return PASS;
    const values = collectWildcardValues(c.data, c.pattern);
    return values.filter((value) => value === v).length <= 1;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field has a duplicate value.`;
  }
}

export class RequiredArrayKeysRule implements RuleContract {
  name = "required_array_keys";
  constructor(private keys: readonly string[]) {}
  validate(v: unknown) {
    return v !== null && typeof v === "object" && this.keys.every((key) => Object.prototype.hasOwnProperty.call(v, key));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must contain the required keys.`;
  }
}

export class DateRule implements RuleContract {
  name = "date";
  coerce(v: unknown) {
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return v;
  }
  validate(v: unknown) {
    return v instanceof Date && !Number.isNaN(v.getTime());
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid date.`;
  }
}

export class DateFormatRule implements RuleContract {
  name = "date_format";
  constructor(private format: string) {}
  validate(v: unknown) {
    if (typeof v !== "string") return false;
    const patterns: Record<string, RegExp> = {
      "Y-m-d": /^\d{4}-\d{2}-\d{2}$/,
      "Y-m-d H:i:s": /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      "c": /^\d{4}-\d{2}-\d{2}T/,
    };
    const re = patterns[this.format];
    return re ? re.test(v) : !Number.isNaN(new Date(v).getTime());
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must match the format ${this.format}.`;
  }
}

export class DateEqualsRule implements RuleContract {
  name = "date_equals";
  constructor(private other: string | Date) {}
  validate(v: unknown, c: ValidationContext) {
    const other = typeof this.other === "string" && c.has(this.other) ? c.get(this.other) : this.other;
    return compareDate(v, other) === 0;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be equal to ${String(this.other)}.`;
  }
}

export class DateComparisonRule implements RuleContract {
  constructor(public name: string, private op: ">" | ">=" | "<" | "<=", private other: string | Date) {}
  validate(v: unknown, c: ValidationContext) {
    const other = typeof this.other === "string" && c.has(this.other) ? c.get(this.other) : this.other;
    const result = compareDate(v, other);
    if (result === undefined) return false;
    if (this.op === ">") return result > 0;
    if (this.op === ">=") return result >= 0;
    if (this.op === "<") return result < 0;
    return result <= 0;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be ${this.name.replace(/_/g, " ")} ${String(this.other)}.`;
  }
}

export class TimezoneRule implements RuleContract {
  name = "timezone";
  validate(v: unknown) {
    if (typeof v !== "string") return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid timezone.`;
  }
}

// ── Size ─────────────────────────────────────────────────────

function sizeOf(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" || Array.isArray(v)) return v.length;
  return NaN;
}

function quoteQualified(conn: ValidationContext["connection"], value: string): string {
  return value.split(".").map((part) => conn.quoteIdentifier(part)).join(".");
}

export class MinRule implements RuleContract {
  name = "min";
  constructor(private n: number) {}
  validate(v: unknown) {
    return sizeOf(v) >= this.n;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be at least ${this.n}.`;
  }
}

export class MaxRule implements RuleContract {
  name = "max";
  constructor(private n: number) {}
  validate(v: unknown) {
    return sizeOf(v) <= this.n;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must not be greater than ${this.n}.`;
  }
}

export class BetweenRule implements RuleContract {
  name = "between";
  constructor(private a: number, private b: number) {}
  validate(v: unknown) {
    const s = sizeOf(v);
    return s >= this.a && s <= this.b;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be between ${this.a} and ${this.b}.`;
  }
}

export class SizeRule implements RuleContract {
  name = "size";
  constructor(private n: number) {}
  validate(v: unknown) {
    return sizeOf(v) === this.n;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be ${this.n}.`;
  }
}

export class ComparisonRule implements RuleContract {
  constructor(public name: string, private op: ">" | ">=" | "<" | "<=", private other: number | string) {}
  validate(v: unknown, c: ValidationContext) {
    const otherValue = typeof this.other === "string" && c.has(this.other) ? c.get(this.other) : this.other;
    const left = typeof v === "number" ? v : sizeOf(v);
    const right = typeof otherValue === "number" ? otherValue : sizeOf(otherValue);
    if (Number.isNaN(left) || Number.isNaN(right)) return false;
    if (this.op === ">") return left > right;
    if (this.op === ">=") return left >= right;
    if (this.op === "<") return left < right;
    return left <= right;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be ${this.name} ${String(this.other)}.`;
  }
}

// ── Format ───────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
const ALPHA_RE = /^[A-Za-z]+$/;
const ALPHANUM_RE = /^[A-Za-z0-9]+$/;
const ALPHADASH_RE = /^[A-Za-z0-9_-]+$/;
const ASCII_RE = /^[\x00-\x7F]*$/;
const MAC_RE = /^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/i;
const HEX_COLOR_RE = /^#(?:[0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/i;

export class EmailRule implements RuleContract {
  name = "email";
  validate(v: unknown) {
    return typeof v === "string" && EMAIL_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid email address.`;
  }
}

export class UrlRule implements RuleContract {
  name = "url";
  validate(v: unknown) {
    if (typeof v !== "string") return false;
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid URL.`;
  }
}

export class UuidRule implements RuleContract {
  name = "uuid";
  validate(v: unknown) {
    return typeof v === "string" && UUID_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid UUID.`;
  }
}

export class RegexRule implements RuleContract {
  name = "regex";
  constructor(private re: RegExp) {}
  validate(v: unknown) {
    this.re.lastIndex = 0;
    return typeof v === "string" && this.re.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field format is invalid.`;
  }
}

export class AlphaRule implements RuleContract {
  name = "alpha";
  validate(v: unknown) {
    return typeof v === "string" && ALPHA_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must only contain letters.`;
  }
}

export class AlphaNumRule implements RuleContract {
  name = "alpha_num";
  validate(v: unknown) {
    return typeof v === "string" && ALPHANUM_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must only contain letters and numbers.`;
  }
}

export class AlphaDashRule implements RuleContract {
  name = "alpha_dash";
  validate(v: unknown) {
    return typeof v === "string" && ALPHADASH_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must only contain letters, numbers, dashes, and underscores.`;
  }
}

export class AsciiRule implements RuleContract {
  name = "ascii";
  validate(v: unknown) {
    return typeof v === "string" && ASCII_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must only contain ASCII characters.`;
  }
}

export class StartsWithRule implements RuleContract {
  name = "starts_with";
  constructor(private values: readonly string[]) {}
  validate(v: unknown) {
    return typeof v === "string" && this.values.some((value) => v.startsWith(value));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must start with one of the allowed values.`;
  }
}

export class EndsWithRule implements RuleContract {
  name = "ends_with";
  constructor(private values: readonly string[]) {}
  validate(v: unknown) {
    return typeof v === "string" && this.values.some((value) => v.endsWith(value));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must end with one of the allowed values.`;
  }
}

export class DoesntStartWithRule implements RuleContract {
  name = "doesnt_start_with";
  constructor(private values: readonly string[]) {}
  validate(v: unknown) {
    return typeof v === "string" && this.values.every((value) => !v.startsWith(value));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must not start with a prohibited value.`;
  }
}

export class DoesntEndWithRule implements RuleContract {
  name = "doesnt_end_with";
  constructor(private values: readonly string[]) {}
  validate(v: unknown) {
    return typeof v === "string" && this.values.every((value) => !v.endsWith(value));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must not end with a prohibited value.`;
  }
}

export class LowercaseValidationRule implements RuleContract {
  name = "lowercase";
  validate(v: unknown) {
    return typeof v === "string" && v === v.toLowerCase();
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be lowercase.`;
  }
}

export class UppercaseRule implements RuleContract {
  name = "uppercase";
  validate(v: unknown) {
    return typeof v === "string" && v === v.toUpperCase();
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be uppercase.`;
  }
}

export class MacAddressRule implements RuleContract {
  name = "mac_address";
  validate(v: unknown) {
    return typeof v === "string" && MAC_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid MAC address.`;
  }
}

export class IpRule implements RuleContract {
  name = "ip";
  validate(v: unknown) {
    return typeof v === "string" && (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}$/.test(v) || (/^[0-9a-f:]+$/i.test(v) && v.includes(":")));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid IP address.`;
  }
}

export class Ipv4Rule extends IpRule {
  name = "ipv4";
  validate(v: unknown) {
    return typeof v === "string" && /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}$/.test(v);
  }
}

export class Ipv6Rule extends IpRule {
  name = "ipv6";
  validate(v: unknown) {
    return typeof v === "string" && /^[0-9a-f:]+$/i.test(v) && v.includes(":");
  }
}

export class ActiveUrlRule extends UrlRule {
  name = "active_url";
}

export class UlidRule implements RuleContract {
  name = "ulid";
  validate(v: unknown) {
    return typeof v === "string" && ULID_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid ULID.`;
  }
}

export class HexColorRule implements RuleContract {
  name = "hex_color";
  validate(v: unknown) {
    return typeof v === "string" && HEX_COLOR_RE.test(v);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a valid hex color.`;
  }
}

export class InRule implements RuleContract {
  name = "in";
  constructor(private values: readonly unknown[]) {}
  validate(v: unknown) {
    return this.values.includes(v);
  }
  message(c: ValidationContext) {
    return `The selected ${c.attribute} is invalid.`;
  }
}

export class NotInRule implements RuleContract {
  name = "not_in";
  constructor(private values: readonly unknown[]) {}
  validate(v: unknown) {
    return !this.values.includes(v);
  }
  message(c: ValidationContext) {
    return `The selected ${c.attribute} is invalid.`;
  }
}

// ── Cross-field ──────────────────────────────────────────────

export class ConfirmedRule implements RuleContract {
  name = "confirmed";
  validate(v: unknown, c: ValidationContext) {
    return v === c.get(`${c.attribute}_confirmation`);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field confirmation does not match.`;
  }
}

export class SameRule implements RuleContract {
  name = "same";
  constructor(private field: string) {}
  validate(v: unknown, c: ValidationContext) {
    return v === c.get(this.field);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must match ${this.field}.`;
  }
}

export class DifferentRule implements RuleContract {
  name = "different";
  constructor(private field: string) {}
  validate(v: unknown, c: ValidationContext) {
    return v !== c.get(this.field);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be different from ${this.field}.`;
  }
}

// ── Files / images ───────────────────────────────────────────

export class FileRule implements RuleContract {
  name = "file";
  validate(v: unknown) {
    return !!v && typeof v === "object" && typeof fileSize(v) === "number";
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a file.`;
  }
}

export class ImageRule extends FileRule {
  name = "image";
  validate(v: unknown) {
    const type = fileType(v);
    const name = fileName(v);
    return super.validate(v) && (!!type?.startsWith("image/") || /\.(jpe?g|png|gif|bmp|svg|webp)$/i.test(name ?? ""));
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be an image.`;
  }
}

export class MimesRule extends FileRule {
  name = "mimes";
  constructor(private extensions: readonly string[]) { super(); }
  validate(v: unknown) {
    const name = fileName(v);
    const ext = name?.split(".").pop()?.toLowerCase();
    return super.validate(v) && !!ext && this.extensions.map((e) => e.toLowerCase()).includes(ext);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field must be a file of an allowed type.`;
  }
}

export class MimeTypesRule extends FileRule {
  name = "mimetypes";
  constructor(private types: readonly string[]) { super(); }
  validate(v: unknown) {
    const type = fileType(v);
    return super.validate(v) && !!type && this.types.includes(type);
  }
}

export class ExtensionsRule extends MimesRule {
  name = "extensions";
}

export class DimensionsRule extends ImageRule {
  name = "dimensions";
  constructor(private options: { width?: number; height?: number; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; ratio?: number }) { super(); }
  validate(v: unknown) {
    if (!super.validate(v)) return false;
    const width = (v as any).width;
    const height = (v as any).height;
    if (typeof width !== "number" || typeof height !== "number") return true;
    if (this.options.width !== undefined && width !== this.options.width) return false;
    if (this.options.height !== undefined && height !== this.options.height) return false;
    if (this.options.minWidth !== undefined && width < this.options.minWidth) return false;
    if (this.options.minHeight !== undefined && height < this.options.minHeight) return false;
    if (this.options.maxWidth !== undefined && width > this.options.maxWidth) return false;
    if (this.options.maxHeight !== undefined && height > this.options.maxHeight) return false;
    if (this.options.ratio !== undefined && Math.abs(width / height - this.options.ratio) > 0.001) return false;
    return true;
  }
}

// ── Higher-level builders ────────────────────────────────────

export class EnumRule implements RuleContract {
  name = "enum";
  constructor(private enumObject: Record<string, unknown>) {}
  validate(v: unknown) {
    return Object.values(this.enumObject).includes(v as any);
  }
  message(c: ValidationContext) {
    return `The selected ${c.attribute} is invalid.`;
  }
}

export class AnyOfRule implements RuleContract {
  name = "any_of";
  constructor(private rules: readonly RuleContract[][]) {}
  async validate(v: unknown, c: ValidationContext) {
    for (const chain of this.rules) {
      let ok = true;
      let value = v;
      for (const rule of chain) {
        if (rule.coerce) value = rule.coerce(value);
        const result = await rule.validate(value, c);
        if (!(typeof result === "boolean" ? result : result.pass)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field does not match any allowed rule set.`;
  }
}

export class CanRule implements RuleContract {
  name = "can";
  constructor(private callback: (value: unknown, ctx: ValidationContext) => boolean | Promise<boolean>) {}
  validate(v: unknown, c: ValidationContext) {
    return this.callback(v, c);
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is not authorized.`;
  }
}

export class CustomRule implements RuleContract {
  constructor(
    public name: string,
    private callback: (value: unknown, ctx: ValidationContext) => RuleResult | Promise<RuleResult>,
    private messageValue: string | ((ctx: ValidationContext) => string) = "The :attribute field is invalid.",
  ) {}

  validate(v: unknown, c: ValidationContext) {
    return this.callback(v, c);
  }

  message(c: ValidationContext) {
    return typeof this.messageValue === "function"
      ? this.messageValue(c)
      : this.messageValue.replace(/:attribute/g, c.attribute);
  }
}

export class PasswordRule implements RuleContract {
  name = "password";
  private minLength = 8;
  private requireLetters = false;
  private requireMixedCase = false;
  private requireNumbers = false;
  private requireSymbols = false;

  min(n: number): this {
    this.minLength = n;
    return this;
  }
  letters(): this {
    this.requireLetters = true;
    return this;
  }
  mixedCase(): this {
    this.requireMixedCase = true;
    return this;
  }
  numbers(): this {
    this.requireNumbers = true;
    return this;
  }
  symbols(): this {
    this.requireSymbols = true;
    return this;
  }
  uncompromised(): this {
    return this;
  }
  validate(v: unknown) {
    if (typeof v !== "string" || v.length < this.minLength) return false;
    if (this.requireLetters && !/[A-Za-z]/.test(v)) return false;
    if (this.requireMixedCase && (!/[a-z]/.test(v) || !/[A-Z]/.test(v))) return false;
    if (this.requireNumbers && !/\d/.test(v)) return false;
    if (this.requireSymbols && !/[^A-Za-z0-9]/.test(v)) return false;
    return true;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is not a valid password.`;
  }
}

// ── DB-aware (async) ─────────────────────────────────────────

export class UniqueRule implements RuleContract {
  name = "unique";
  private wheres: Array<{ column: string; op: "=" | "<>" | "IS NULL" | "IS NOT NULL"; value?: unknown }> = [];
  private ignoreId?: unknown;
  private ignoreFieldName?: string;
  private ignoreColumn = "id";

  constructor(
    private table: string,
    private column?: string,
  ) {}

  where(column: string, value: unknown): this {
    this.wheres.push({ column, op: "=", value });
    return this;
  }

  whereNot(column: string, value: unknown): this {
    this.wheres.push({ column, op: "<>", value });
    return this;
  }

  whereNull(column: string): this {
    this.wheres.push({ column, op: "IS NULL" });
    return this;
  }

  whereNotNull(column: string): this {
    this.wheres.push({ column, op: "IS NOT NULL" });
    return this;
  }

  ignore(id: unknown, column = "id"): this {
    this.ignoreId = id;
    this.ignoreColumn = column;
    return this;
  }

  ignoreField(field: string, column = "id"): this {
    this.ignoreFieldName = field;
    this.ignoreColumn = column;
    return this;
  }

  withoutTrashed(column = "deleted_at"): this {
    return this.whereNull(column);
  }

  async validate(v: unknown, c: ValidationContext): Promise<RuleResult> {
    if (isAbsent(v)) return SKIP;
    const col = this.column ?? c.attribute;
    const conn = c.connection;
    const g = conn.getGrammar();
    const table = conn.qualifyTable(this.table);
    let sql =
      `SELECT 1 FROM ${quoteQualified(conn, table)} ` +
      `WHERE ${conn.quoteIdentifier(col)} = ${g.placeholder(1)}`;
    const bindings: unknown[] = [v];
    const ignoreId = this.ignoreFieldName ? c.get(this.ignoreFieldName) : this.ignoreId;
    if (ignoreId !== undefined) {
      sql += ` AND ${conn.quoteIdentifier(this.ignoreColumn)} <> ${g.placeholder(2)}`;
      bindings.push(ignoreId);
    }
    for (const where of this.wheres) {
      if (where.op === "IS NULL" || where.op === "IS NOT NULL") {
        sql += ` AND ${conn.quoteIdentifier(where.column)} ${where.op}`;
      } else {
        bindings.push(where.value);
        sql += ` AND ${conn.quoteIdentifier(where.column)} ${where.op} ${g.placeholder(bindings.length)}`;
      }
    }
    sql += " LIMIT 1";
    const rows = await conn.query(sql, bindings);
    return rows.length === 0;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} has already been taken.`;
  }
}

export class ExistsRule implements RuleContract {
  name = "exists";
  private wheres: Array<{ column: string; op: "=" | "<>" | "IS NULL" | "IS NOT NULL"; value?: unknown }> = [];
  constructor(private table: string, private column?: string) {}

  where(column: string, value: unknown): this {
    this.wheres.push({ column, op: "=", value });
    return this;
  }

  whereNot(column: string, value: unknown): this {
    this.wheres.push({ column, op: "<>", value });
    return this;
  }

  whereNull(column: string): this {
    this.wheres.push({ column, op: "IS NULL" });
    return this;
  }

  whereNotNull(column: string): this {
    this.wheres.push({ column, op: "IS NOT NULL" });
    return this;
  }

  withoutTrashed(column = "deleted_at"): this {
    return this.whereNull(column);
  }

  async validate(v: unknown, c: ValidationContext): Promise<RuleResult> {
    if (isAbsent(v)) return SKIP;
    const col = this.column ?? c.attribute;
    const conn = c.connection;
    const g = conn.getGrammar();
    const table = conn.qualifyTable(this.table);
    let sql =
      `SELECT 1 FROM ${quoteQualified(conn, table)} ` +
      `WHERE ${conn.quoteIdentifier(col)} = ${g.placeholder(1)}`;
    const bindings: unknown[] = [v];
    for (const where of this.wheres) {
      if (where.op === "IS NULL" || where.op === "IS NOT NULL") {
        sql += ` AND ${conn.quoteIdentifier(where.column)} ${where.op}`;
      } else {
        bindings.push(where.value);
        sql += ` AND ${conn.quoteIdentifier(where.column)} ${where.op} ${g.placeholder(bindings.length)}`;
      }
    }
    sql += " LIMIT 1";
    const rows = await conn.query(sql, bindings);
    return rows.length > 0;
  }
  message(c: ValidationContext) {
    return `The selected ${c.attribute} is invalid.`;
  }
}

// ── Transform / default ──────────────────────────────────────

export class DefaultRule implements RuleContract {
  name = "default";
  constructor(private value: unknown) {}
  coerce(v: unknown) {
    return v === undefined ? this.value : v;
  }
  validate() {
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is invalid.`;
  }
}

export class TrimRule implements RuleContract {
  name = "trim";
  coerce(v: unknown) {
    return typeof v === "string" ? v.trim() : v;
  }
  validate() {
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is invalid.`;
  }
}

export class LowercaseRule implements RuleContract {
  name = "lowercase";
  coerce(v: unknown) {
    return typeof v === "string" ? v.toLowerCase() : v;
  }
  validate() {
    return PASS;
  }
  message(c: ValidationContext) {
    return `The ${c.attribute} field is invalid.`;
  }
}
