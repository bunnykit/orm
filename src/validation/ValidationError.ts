import type { ErrorBag } from "./types.js";

export class ValidationError extends Error {
  readonly errors: ErrorBag;

  constructor(errors: ErrorBag) {
    const first = Object.values(errors)[0]?.[0] ?? "Validation failed.";
    super(first);
    this.name = "ValidationError";
    this.errors = errors;
  }

  /** First error message for a field, or undefined. */
  first(field?: string): string | undefined {
    if (field) return this.errors[field]?.[0];
    return Object.values(this.errors)[0]?.[0];
  }

  /** All messages for a field. */
  get(field: string): string[] {
    return this.errors[field] ?? [];
  }

  /** Flat list of every message. */
  all(): string[] {
    return Object.values(this.errors).flat();
  }
}
