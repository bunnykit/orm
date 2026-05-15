import type { RuleContract, ValidationContext } from "./types.js";

export type MessageOverrides = Record<string, string>;

export function resolveMessage(
  overrides: MessageOverrides,
  field: string,
  rule: RuleContract,
  ctx: ValidationContext,
): string {
  return (
    overrides[`${field}.${rule.name}`] ??
    overrides[field] ??
    overrides[`${ctx.pattern}.${rule.name}`] ??
    overrides[ctx.pattern] ??
    rule.message(ctx)
  );
}
