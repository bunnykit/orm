import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { Connection } from "../connection/Connection.js";
import { TypeMapper } from "./TypeMapper.js";
import { normalizePathList, snakeCase } from "../utils.js";

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: any;
}

export interface ModelDeclaration {
  path: string;
  className?: string;
}

export interface TypeGeneratorOptions {
  outDir: string;
  stubs?: boolean;
  declarations?: boolean;
  modelDeclarations?: Record<string, string | ModelDeclaration>;
  modelDirectory?: string;
  modelDirectories?: string[];
  modelImportPrefix?: string;
  singularModels?: boolean;
  declarationDirName?: string;
}

export class TypeGenerator {
  constructor(
    private connection: Connection,
    private options: TypeGeneratorOptions
  ) {}

  async generate(): Promise<void> {
    const tables = await this.getTables();
    const declarationOnly = this.options.declarations ?? !this.options.stubs;
    const targets: { outDir: string; modelImportPrefix?: string }[] = declarationOnly
      ? this.getDeclarationTargets()
      : [{ outDir: this.options.outDir }];

    for (const target of targets) {
      await mkdir(target.outDir, { recursive: true });

      for (const table of tables) {
        const columns = await this.getColumns(table);
        const className = this.toClassName(table);
        const interfaceName = `${className}Attributes`;

        const lines: string[] = [];
        if (!declarationOnly) {
          lines.push(`import { Model } from "@bunnykit/orm";`);
          lines.push("");
        }

        lines.push(`export interface ${interfaceName} {`);
        for (const col of columns) {
          const tsType = TypeMapper.sqlToTsType(col.type, col.nullable);
          lines.push(`  ${col.name}${col.nullable ? "?" : ""}: ${tsType};`);
        }
        lines.push("}");
        lines.push("");

        const modelDeclaration = this.getModelDeclaration(table, className, target.modelImportPrefix);
        if (declarationOnly && modelDeclaration) {
          lines.push(`declare module "${modelDeclaration.path}" {`);
          lines.push(`  interface ${modelDeclaration.className} {`);
          for (const col of columns) {
            const tsType = TypeMapper.sqlToTsType(col.type, col.nullable);
            lines.push(`    ${col.name}${col.nullable ? "?" : ""}: ${tsType};`);
          }
          lines.push("  }");
          lines.push("}");
          lines.push("");
        }

        if (!declarationOnly && this.options.stubs) {
          lines.push(`export class ${className}Base extends Model<${interfaceName}> {`);
          lines.push(`  static table = "${table}";`);
          lines.push("");

          for (const col of columns) {
            const tsType = TypeMapper.sqlToTsType(col.type, col.nullable);
            lines.push(`  get ${col.name}(): ${tsType} {`);
            lines.push(`    return this.getAttribute("${col.name}");`);
            lines.push(`  }`);
            lines.push(`  set ${col.name}(value: ${tsType}) {`);
            lines.push(`    this.setAttribute("${col.name}", value);`);
            lines.push(`  }`);
            lines.push("");
          }

          lines.push("}");
        }

        const fileName = `${snakeCase(className)}.${declarationOnly ? "d.ts" : "ts"}`;
        const filePath = join(target.outDir, fileName);
        await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
      }

      const indexLines = tables.map((table) => {
        const className = this.toClassName(table);
        const fileName = snakeCase(className);
        return `export * from "./${fileName}";`;
      });
      await writeFile(join(target.outDir, `index.${declarationOnly ? "d.ts" : "ts"}`), indexLines.join("\n") + "\n", "utf-8");
    }
  }

  private getModelDeclaration(
    table: string,
    fallbackClassName: string,
    modelImportPrefix?: string
  ): { path: string; className: string } | null {
    const declaration = this.options.modelDeclarations?.[table];
    if (!declaration) return this.getConventionModelDeclaration(table, modelImportPrefix);
    if (typeof declaration === "string") {
      return { path: declaration, className: this.toModelClassName(table, fallbackClassName) };
    }
    return { path: declaration.path, className: declaration.className || this.toModelClassName(table, fallbackClassName) };
  }

  private getConventionModelDeclaration(table: string, modelImportPrefix?: string): { path: string; className: string } | null {
    const prefix = modelImportPrefix || this.options.modelImportPrefix || this.options.modelDirectory;
    if (!prefix) return null;
    const className = this.toModelClassName(table);
    return {
      path: `${prefix.replace(/\/$/, "")}/${className}`,
      className,
    };
  }

  private toModelClassName(table: string, fallback?: string): string {
    if (this.options.singularModels === false) {
      return fallback || this.toClassName(table);
    }
    return this.toClassName(this.singularizeTable(table));
  }

  private singularizeTable(table: string): string {
    return table
      .split("_")
      .map((part) => this.singularizeWord(part))
      .join("_");
  }

  private singularizeWord(word: string): string {
    if (word.endsWith("ies") && word.length > 3) return `${word.slice(0, -3)}y`;
    if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes") || word.endsWith("ches") || word.endsWith("shes")) {
      return word.slice(0, -2);
    }
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }

  private async getTables(): Promise<string[]> {
    const driver = this.connection.getDriverName();
    let sql: string;

    if (driver === "sqlite") {
      sql = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_inner_sequence' AND name != 'migrations'`;
    } else if (driver === "mysql") {
      sql = "SHOW TABLES";
    } else {
      const schema = this.connection.getSchema() || "public";
      sql = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' AND table_type = 'BASE TABLE'`;
    }

    const rows = await this.connection.query(sql);

    if (driver === "sqlite") {
      return rows.map((r: any) => r.name);
    } else if (driver === "mysql") {
      const key = Object.keys(rows[0] ?? {})[0] ?? "Tables_in_" + (await this.getCurrentDatabase());
      return rows.map((r: any) => r[key]);
    } else {
      return rows.map((r: any) => r.table_name);
    }
  }

  private getDeclarationTargets(): { outDir: string; modelImportPrefix: string }[] {
    const modelDirectories = normalizePathList(this.options.modelDirectories || this.options.modelDirectory);
    if (modelDirectories.length === 0) {
      return [
        {
          outDir: this.options.outDir,
          modelImportPrefix: this.options.modelImportPrefix || this.options.modelDirectory || "",
        },
      ];
    }

    const declarationDirName = this.options.declarationDirName || "types";
    return modelDirectories.map((dir) => ({
      outDir: join(dir, declarationDirName),
      modelImportPrefix: this.options.modelImportPrefix || "..",
    }));
  }

  private async getCurrentDatabase(): Promise<string> {
    const rows = await this.connection.query("SELECT DATABASE() as db");
    return rows[0]?.db || "";
  }

  private async getColumns(table: string): Promise<ColumnInfo[]> {
    const driver = this.connection.getDriverName();

    if (driver === "sqlite") {
      const rows = await this.connection.query(`PRAGMA table_info(${table})`);
      return rows.map((r: any) => ({
        name: r.name,
        type: r.type,
        nullable: !r.notnull,
        default: r.dflt_value,
      }));
    }

    if (driver === "mysql") {
      const rows = await this.connection.query(`SHOW COLUMNS FROM ${table}`);
      return rows.map((r: any) => ({
        name: r.Field,
        type: r.Type,
        nullable: r.Null === "YES",
        default: r.Default,
      }));
    }

    // postgres
    const schema = this.connection.getSchema() || "public";
    const rows = await this.connection.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${table}' AND table_schema = '${schema}' ORDER BY ordinal_position`
    );
    return rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === "YES",
      default: r.column_default,
    }));
  }

  private toClassName(table: string): string {
    return table
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");
  }
}
