import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export class MigrationCreator {
  async create(name: string, path: string): Promise<string> {
    await mkdir(path, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const filename = `${timestamp}_${this.snakeCase(name)}.ts`;
    const filePath = join(path, filename);

    const stub = `import { Migration } from "@bunnykit/orm";
import { Schema } from "@bunnykit/orm";

export default class ${this.toClassName(name)} extends Migration {
  async up(): Promise<void> {
    // Schema.create("table_name", (table) => {
    //   table.increments("id");
    //   table.timestamps();
    // });
  }

  async down(): Promise<void> {
    // Schema.dropIfExists("table_name");
  }
}
`;

    await writeFile(filePath, stub, "utf-8");
    return filePath;
  }

  private snakeCase(str: string): string {
    return str
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      .replace(/^_/g, "");
  }

  private toClassName(name: string): string {
    return name
      .split(/[_\-]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");
  }
}
