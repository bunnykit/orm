import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { basename, extname, join, relative, resolve, sep } from "path";
import { pathToFileURL } from "url";
import { snakeCase } from "../utils.js";

function isUnderExcludedPath(fullPath: string, excludeSet: Set<string>): boolean {
  for (const excluded of excludeSet) {
    if (fullPath === excluded || fullPath.startsWith(excluded + sep)) {
      return true;
    }
  }
  return false;
}

async function walkFiles(dir: string, exclude?: string[]): Promise<string[]> {
  const excludeSet = new Set((exclude || []).map((e) => resolve(process.cwd(), e)));
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "types") continue;
    const fullPath = join(dir, entry.name);
    if (isUnderExcludedPath(fullPath, excludeSet)) continue;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath, exclude)));
      continue;
    }
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name.endsWith(".d.ts") || name.endsWith(".test.ts") || name.endsWith(".spec.ts")) continue;
    if (![".ts", ".js", ".mts", ".mjs", ".cts", ".cjs"].includes(extname(name))) continue;
    files.push(fullPath);
  }
  return files;
}

function isModelSubclass(ctor: any): boolean {
  if (typeof ctor !== "function" || !ctor.prototype) return false;
  let proto = ctor.prototype;
  while (proto) {
    if (proto.constructor?.name === "Model") {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

export interface ModelDeclarationInfo {
  table: string;
  className: string;
  relativePath: string;
  relativeToRoot: string;
}

export async function discoverModelDeclarations(root: string, outDir: string, exclude?: string[]): Promise<Map<string, ModelDeclarationInfo>> {
  const declarations = new Map<string, ModelDeclarationInfo>();
  const resolvedRoot = resolve(process.cwd(), root);
  if (!existsSync(resolvedRoot)) return declarations;

  const files = await walkFiles(resolvedRoot, exclude);
  for (const file of files.sort()) {
    try {
      const mod = await import(pathToFileURL(file).href);
      const relativePath = relative(resolve(process.cwd(), outDir), file).replace(/\.[^/.]+$/, "");
      const relativeToRoot = relative(resolvedRoot, file).replace(/\.[^/.]+$/, "");

      for (const [exportName, exported] of Object.entries(mod)) {
        if (exportName === "default") continue;
        if (isModelSubclass(exported)) {
          const table = (exported as any).table || snakeCase((exported as any).name) + "s";
          const className = (exported as any).name || exportName;
          declarations.set(table, { table, className, relativePath, relativeToRoot });
        }
      }

      if (isModelSubclass(mod.default)) {
        const table =
          (mod.default as any).table || snakeCase(mod.default.name || basename(file, extname(file))) + "s";
        const className = mod.default.name || basename(file, extname(file));
        declarations.set(table, { table, className, relativePath, relativeToRoot });
      }
    } catch {
      // Skip files that fail to import
    }
  }

  return declarations;
}

export async function discoverModelTables(roots: string[], exclude?: string[]): Promise<string[]> {
  const tables = new Set<string>();

  for (const root of roots) {
    const resolvedRoot = resolve(process.cwd(), root);
    if (!existsSync(resolvedRoot)) continue;
    const files = await walkFiles(resolvedRoot, exclude);
    for (const file of files.sort()) {
      try {
        const mod = await import(pathToFileURL(file).href);
        for (const [, exported] of Object.entries(mod)) {
          if (isModelSubclass(exported)) {
            const table = (exported as any).table || snakeCase((exported as any).name) + "s";
            tables.add(table);
          }
        }
        if (isModelSubclass(mod.default)) {
          const table =
            (mod.default as any).table || snakeCase(mod.default.name || basename(file, extname(file))) + "s";
          tables.add(table);
        }
      } catch {
        // Skip files that fail to import
      }
    }
  }

  return Array.from(tables);
}
