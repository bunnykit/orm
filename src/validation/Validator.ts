import type { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import {
  RuleBuilder,
  type InferOutput,
  type StandardSchemaIssue,
  type StandardSchemaV1,
  type ValidationSchema,
} from "./Rule.js";
import { ValidationError } from "./ValidationError.js";
import { resolveMessage, type MessageOverrides } from "./messages.js";
import type { ErrorBag, ValidationContext } from "./types.js";

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

function pathParts(path: string): string[] {
  return path.split(".").filter(Boolean);
}

function getPath(data: Record<string, any>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(data, path)) return data[path];
  let current: any = data;
  for (const part of pathParts(path)) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function hasPath(data: Record<string, any>, path: string): boolean {
  if (Object.prototype.hasOwnProperty.call(data, path)) return true;
  let current: any = data;
  for (const part of pathParts(path)) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

function setPath(data: Record<string, any>, path: string, value: unknown): void {
  if (!path.includes(".")) {
    data[path] = value;
    return;
  }
  let current: any = data;
  const parts = pathParts(path);
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = parts[i + 1];
    current[part] ??= /^\d+$/.test(next) ? [] : {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function wildcardValues(data: Record<string, any>, pattern: string): string[] {
  if (!pattern.includes("*")) return [pattern];
  const found: string[] = [];
  const parts = pathParts(pattern);
  const visit = (value: unknown, index: number, path: string[]) => {
    if (index === parts.length) {
      found.push(path.join("."));
      return;
    }
    const part = parts[index];
    if (part === "*") {
      if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, index + 1, [...path, String(i)]));
      } else if (value && typeof value === "object") {
        for (const key of Object.keys(value)) {
          visit((value as Record<string, unknown>)[key], index + 1, [...path, key]);
        }
      }
      return;
    }
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, part)) {
      visit((value as Record<string, unknown>)[part], index + 1, [...path, part]);
    }
  };
  visit(data, 0, []);
  return found.length ? found : [pattern.replace(/\*/g, "0")];
}

function resolveRelativePath(pattern: string, attribute: string, other: string): string {
  if (!other.includes("*")) return other;
  const patternParts = pathParts(pattern);
  const attrParts = pathParts(attribute);
  let wildcardIndex = 0;
  const wildcardValuesInAttr = patternParts.flatMap((part, i) => part === "*" ? [attrParts[i]] : []);
  return pathParts(other).map((part) => part === "*" ? wildcardValuesInAttr[wildcardIndex++] ?? part : part).join(".");
}

function makeContext(
  attribute: string,
  pattern: string,
  data: Record<string, any>,
  explicitConnection?: Connection,
): ValidationContext {
  const context = {
    attribute,
    pattern,
    data,
    get: (path: string) => getPath(data, resolveRelativePath(pattern, attribute, path)),
    has: (path: string) => hasPath(data, resolveRelativePath(pattern, attribute, path)),
  } as ValidationContext;
  Object.defineProperty(context, "connection", {
    enumerable: true,
    get: () => resolveConnection(explicitConnection),
  });
  return context;
}

function isRuleBuilder(value: unknown): value is RuleBuilder<any, any> {
  return value instanceof RuleBuilder;
}

function isValidationObjectSchema<S extends ValidationSchema>(
  value: unknown,
): value is ValidationObjectSchema<S> {
  return !!value
    && typeof value === "object"
    && "entries" in value
    && "~standard" in value
    && typeof (value as ValidationObjectSchema<S>).parse === "function"
    && typeof (value as ValidationObjectSchema<S>).safeParse === "function";
}

function toIssuePath(field: string): readonly { key: PropertyKey }[] | undefined {
  const parts = field.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.map((part) => ({ key: /^\d+$/.test(part) ? Number(part) : part }));
}

function bagToIssues(bag: ErrorBag): readonly StandardSchemaIssue[] {
  const issues: StandardSchemaIssue[] = [];
  for (const [field, messages] of Object.entries(bag)) {
    const path = toIssuePath(field);
    for (const message of messages) {
      issues.push(path ? { message, path } : { message });
    }
  }
  return issues;
}

function isObjectInput(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectInputError(): ValidationError {
  return new ValidationError({ "": ["The value must be an object."] });
}

type SafeParseResult<T> =
  | { success: true; output: T }
  | { success: false; issues: ErrorBag };

type RootValue<B> = B extends RuleBuilder<infer V, any> ? V : never;
type SchemaSafeParseResult<T> =
  | { success: true; output: T }
  | { success: false; issues: readonly StandardSchemaIssue[] };

export interface ValidationObjectSchema<S extends ValidationSchema> {
  readonly entries: S;
  readonly "~standard": StandardSchemaV1<any, InferOutput<S>>["~standard"];
  parse(data: unknown): Promise<InferOutput<S>>;
  validate(data: unknown): Promise<SchemaSafeParseResult<InferOutput<S>>>;
  safeParse(data: unknown): Promise<SchemaSafeParseResult<InferOutput<S>>>;
}

const IMPLICIT_RULES = new Set([
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

export class Validator<S extends ValidationSchema> {
  private customMessages: MessageOverrides = {};
  private stopOnFirst = false;
  private collectAll = false;
  private ran = false;
  private bag: ErrorBag = {};
  private output: Record<string, any> = {};

  private constructor(
    private data: Record<string, any>,
    private schema: S,
    private explicitConnection?: Connection,
  ) {}

  static make<S extends ValidationSchema>(
    data: Record<string, any>,
    schema: S,
    connection?: Connection,
  ): Validator<S> {
    return new Validator(data ?? {}, schema, connection);
  }

  static rule(): RuleBuilder {
    return new RuleBuilder();
  }

  static required(): RuleBuilder {
    return new RuleBuilder().required();
  }

  static schema<S extends ValidationSchema>(schema: S): ValidationObjectSchema<S> {
    const validate = async (data: unknown): Promise<InferOutput<S>> => {
      if (!isObjectInput(data)) {
        throw objectInputError();
      }
      return await Validator.make(data, schema).validate();
    };

    const safeParse = async (data: unknown): Promise<SchemaSafeParseResult<InferOutput<S>>> => {
      try {
        return { success: true, output: await validate(data) };
      } catch (error) {
        if (error instanceof ValidationError) {
          return { success: false, issues: bagToIssues(error.errors) };
        }
        throw error;
      }
    };

    return {
      entries: schema,
      async parse(data: unknown) {
        return await validate(data);
      },
      async validate(data: unknown) {
        return await safeParse(data);
      },
      async safeParse(data: unknown) {
        return await safeParse(data);
      },
      get "~standard"() {
        return {
          version: 1,
          vendor: "bunnykit",
          validate: async (value: unknown) => {
            const result = await safeParse(value);
            if (result.success) {
              return { value: result.output };
            }
            return { issues: result.issues };
          },
        } as StandardSchemaV1<any, InferOutput<S>>["~standard"];
      },
    };
  }

  static async parse<S extends ValidationSchema>(
    schema: S,
    data: Record<string, any>,
    connection?: Connection,
  ): Promise<InferOutput<S>>;
  static async parse<B extends RuleBuilder<any, any>>(
    schema: B,
    data: unknown,
    connection?: Connection,
  ): Promise<RootValue<B>>;
  static async parse<S extends ValidationSchema>(
    schema: ValidationObjectSchema<S>,
    data: unknown,
    connection?: Connection,
  ): Promise<InferOutput<S>>;
  static async parse(
    schema: ValidationSchema | RuleBuilder<any, any> | ValidationObjectSchema<any>,
    data: unknown,
    connection?: Connection,
  ): Promise<unknown> {
    if (isRuleBuilder(schema)) {
      return await Validator.make({ value: data }, { value: schema }, connection).validate().then((result) => result.value);
    }
    if (isValidationObjectSchema(schema)) {
      return await schema.parse(data);
    }
    if (!isObjectInput(data)) {
      throw objectInputError();
    }
    return await Validator.make(data, schema as ValidationSchema, connection).validate();
  }

  static async safeParse<S extends ValidationSchema>(
    schema: S,
    data: Record<string, any>,
    connection?: Connection,
  ): Promise<SafeParseResult<InferOutput<S>>>;
  static async safeParse<B extends RuleBuilder<any, any>>(
    schema: B,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<RootValue<B>>>;
  static async safeParse<S extends ValidationSchema>(
    schema: ValidationObjectSchema<S>,
    data: unknown,
    connection?: Connection,
  ): Promise<SchemaSafeParseResult<InferOutput<S>>>;
  static async safeParse(
    schema: ValidationSchema | RuleBuilder<any, any> | ValidationObjectSchema<any>,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<unknown> | SchemaSafeParseResult<unknown>> {
    if (isValidationObjectSchema(schema)) {
      return await schema.safeParse(data);
    }
    try {
      const output = await Validator.parse(schema as any, data as any, connection);
      return { success: true, output };
    } catch (error) {
      if (error instanceof ValidationError) {
        return { success: false, issues: error.errors };
      }
      throw error;
    }
  }

  static async validate<S extends ValidationSchema>(
    schema: S,
    data: Record<string, any>,
    connection?: Connection,
  ): Promise<SafeParseResult<InferOutput<S>>>;
  static async validate<B extends RuleBuilder<any, any>>(
    schema: B,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<RootValue<B>>>;
  static async validate<S extends ValidationSchema>(
    schema: ValidationObjectSchema<S>,
    data: unknown,
    connection?: Connection,
  ): Promise<SchemaSafeParseResult<InferOutput<S>>>;
  static async validate(
    schema: ValidationSchema | RuleBuilder<any, any> | ValidationObjectSchema<any>,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<unknown> | SchemaSafeParseResult<unknown>> {
    return await Validator.safeParse(schema as any, data as any, connection);
  }

  /** Override default messages, keyed by "field" or "field.rule". */
  messages(overrides: MessageOverrides): this {
    this.customMessages = { ...this.customMessages, ...overrides };
    return this;
  }

  stopOnFirstFailure(): this {
    this.stopOnFirst = true;
    return this;
  }

  collectAllErrors(): this {
    this.collectAll = true;
    return this;
  }

  private async run(): Promise<void> {
    if (this.ran) return;
    this.ran = true;

    for (const pattern of Object.keys(this.schema)) {
      const builder = this.schema[pattern] as RuleBuilder<any, any>;
      const attributes = wildcardValues(this.data, pattern);
      for (const field of attributes) {
      const ctx = makeContext(field, pattern, this.data, this.explicitConnection);

      let value = getPath(this.data, field);
      let excluded = false;
      const wasSupplied = hasPath(this.data, field);
      const shouldValidateMissing = builder.specs.some((ruleObj) => IMPLICIT_RULES.has(ruleObj.name));

      if (!wasSupplied && !shouldValidateMissing) {
        continue;
      }

      // Defaults are ergonomic when declared last in a chain, e.g.
      // rule().in(["admin", "member"]).default("member").
      for (const ruleObj of builder.specs) {
        if (ruleObj.name === "default" && ruleObj.coerce) {
          value = ruleObj.coerce(value);
        }
      }

      for (const ruleObj of builder.specs) {
        if (ruleObj.name === "default") continue;
        if (ruleObj.coerce) {
          value = ruleObj.coerce(value);
        }
        const result = await ruleObj.validate(value, ctx);
        const pass = typeof result === "boolean" ? result : result.pass;
        const skip = typeof result === "boolean" ? false : !!result.skip;
        const exclude = typeof result === "boolean" ? false : !!result.exclude;

        if (exclude) {
          excluded = true;
          break;
        }

        if (!pass) {
          const msg = resolveMessage(this.customMessages, field, ruleObj, ctx);
          (this.bag[field] ??= []).push(msg);
          if (this.stopOnFirst) return;
          if (!this.collectAll) break; // default: stop running rules for this field after first failure
        }
        if (skip) {
          break;
        }
      }

      // Include the (possibly coerced/defaulted) value when the field passed
      // and either was supplied in the input or produced by a default/coerce.
      const hadError = !!this.bag[field];
      if (!excluded && !hadError && (wasSupplied || value !== undefined)) {
        setPath(this.output, field, value);
      }
      }
    }
  }

  async passes(): Promise<boolean> {
    await this.run();
    return Object.keys(this.bag).length === 0;
  }

  async fails(): Promise<boolean> {
    return !(await this.passes());
  }

  async errors(): Promise<ErrorBag> {
    await this.run();
    return this.bag;
  }

  /** Validate and return the typed, coerced data. Throws ValidationError on failure. */
  async validate(): Promise<InferOutput<S>> {
    await this.run();
    if (Object.keys(this.bag).length > 0) {
      throw new ValidationError(this.bag);
    }
    return this.output as InferOutput<S>;
  }

  /** Alias of validate(). */
  validated(): Promise<InferOutput<S>> {
    return this.validate();
  }

  parse(): Promise<InferOutput<S>> {
    return this.validate();
  }

  async safeParse(): Promise<SafeParseResult<InferOutput<S>>> {
    try {
      return { success: true, output: await this.validate() };
    } catch (error) {
      if (error instanceof ValidationError) {
        return { success: false, issues: error.errors };
      }
      throw error;
    }
  }
}
