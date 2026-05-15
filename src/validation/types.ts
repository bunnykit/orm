import type { Connection } from "../connection/Connection.js";

export interface ValidationContext {
  /** The attribute (field) currently being validated. */
  attribute: string;
  /** The original schema key. Useful when validating expanded wildcards. */
  pattern: string;
  /** The full input object — needed by cross-field rules (confirmed, same, requiredIf). */
  data: Record<string, any>;
  /** Retrieve a value by dotted path. `*` in paths is resolved from wildcard attributes when possible. */
  get(path: string): unknown;
  /** Whether the input contains a value at a dotted path. */
  has(path: string): boolean;
  /** Connection to use for DB-aware rules (unique/exists). Tenant-resolved. */
  connection: Connection;
}

export interface RuleContract {
  /** Stable identifier, used for default message lookup. */
  name: string;
  /**
   * Return true if the value passes. May be async (DB rules).
   * `skip` short-circuits the remaining rules for this field as a pass
   * (used by nullable/sometimes when the value is absent).
   */
  validate(
    value: unknown,
    ctx: ValidationContext,
  ): ExtendedRuleResult | Promise<ExtendedRuleResult>;
  /** Human-readable failure message. */
  message(ctx: ValidationContext): string;
  /** Optionally transform the value before the next rule sees it. */
  coerce?(value: unknown): unknown;
}

export type RuleResult = boolean | { pass: boolean; skip?: boolean };
export type ExtendedRuleResult = boolean | { pass: boolean; skip?: boolean; exclude?: boolean };

export type ErrorBag = Record<string, string[]>;
