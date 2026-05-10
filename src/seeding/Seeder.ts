import { existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { basename, extname, resolve } from "path";
import { pathToFileURL } from "url";
import { Connection } from "../connection/Connection.js";
import { TenantContext } from "../connection/TenantContext.js";
import { Schema } from "../schema/Schema.js";
import { normalizePathList, toPosixPath } from "../utils.js";

type SeederClass = new (connection?: Connection) => Seeder;
type SeederEntry = Seeder | SeederClass;
type SeederInput = SeederEntry | SeederEntry[] | Record<string, SeederEntry>;

function isSeederClass(value: unknown): value is SeederClass {
  return typeof value === "function";
}

function normalizeSeederEntries(input: SeederInput | SeederInput[]): SeederEntry[] {
  const items = Array.isArray(input) ? input : [input];
  const seeders: SeederEntry[] = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      seeders.push(...item);
      continue;
    }
    if (item && typeof item === "object" && !isSeederClass(item) && !(item instanceof Seeder)) {
      seeders.push(...Object.values(item as Record<string, SeederEntry>));
      continue;
    }
    seeders.push(item as SeederEntry);
  }
  return seeders;
}

export abstract class Seeder {
  constructor(protected connection: Connection = Schema.getConnection()) {}

  abstract run(): Promise<void> | void;

  protected async call(...seeders: SeederInput[]): Promise<void> {
    for (const seeder of normalizeSeederEntries(seeders)) {
      const instance = typeof seeder === "function" ? new seeder(this.connection) : seeder;
      await instance.run();
    }
  }
}

export class SeederRunner {
  constructor(private connection?: Connection) {}

  private getConnection(): Connection {
    return TenantContext.current()?.connection || this.connection || Schema.getConnection();
  }

  async run(...seeders: SeederInput[]): Promise<void> {
    const connection = this.getConnection();
    for (const seeder of normalizeSeederEntries(seeders)) {
      const instance = typeof seeder === "function" ? new seeder(connection) : seeder;
      await instance.run();
    }
  }

  async runPaths(paths: string | string[]): Promise<void> {
    const files = await this.getSeederFiles(paths);
    for (const file of files) {
      await this.runFile(file);
    }
  }

  async runFile(file: string): Promise<void> {
    const resolved = resolve(file);
    const module = await import(pathToFileURL(resolved).href);
    const SeederClass = module.default || Object.values(module)[0];
    if (!SeederClass) {
      throw new Error(`Seeder ${file} does not export a class.`);
    }
    await this.run(SeederClass as SeederClass);
  }

  async runTarget(target: string, searchPaths: string | string[] = "./database/seeders"): Promise<void> {
    const resolved = resolve(target);
    if (existsSync(resolved) && (await stat(resolved)).isFile()) {
      await this.runFile(resolved);
      return;
    }

    const files = await this.getSeederFiles(searchPaths);
    const normalizedTarget = target.replace(/\.(ts|js|mts|mjs|cts|cjs)$/i, "");
    const match = files.find((file) => {
      const name = basename(file, extname(file));
      return name === normalizedTarget || file.endsWith(target) || file.endsWith(`${target}.ts`) || file.endsWith(`${target}.js`);
    });

    if (!match) {
      throw new Error(`Seeder "${target}" could not be found in ${normalizePathList(searchPaths).join(", ")}.`);
    }

    await this.runFile(match);
  }

  private async getSeederFiles(paths: string | string[]): Promise<string[]> {
    const files: string[] = [];
    for (const path of normalizePathList(paths)) {
      const root = resolve(path);
      if (!existsSync(root)) continue;
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) continue;
        if (![".ts", ".js", ".mts", ".mjs", ".cts", ".cjs"].includes(extname(entry.name))) continue;
        files.push(toPosixPath(resolve(root, entry.name)));
      }
    }
    return files.sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));
  }
}
