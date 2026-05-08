export class TypeMapper {
  static sqlToTsType(sqlType: string, nullable: boolean): string {
    const base = this.mapBaseType(sqlType);
    return nullable && base !== "any" ? `${base} | null` : base;
  }

  private static mapBaseType(sqlType: string): string {
    const t = sqlType.toLowerCase();

    // Integers & numbers
    if (/int|serial|float|double|real|decimal|numeric/.test(t)) {
      return "number";
    }

    // Boolean
    if (/bool/.test(t)) {
      return "boolean";
    }

    // JSON
    if (/json/.test(t)) {
      return "any";
    }

    // Binary / BLOB
    if (/blob|bytea|binary|varbinary/.test(t)) {
      return "Buffer";
    }

    // Default to string for everything else (varchar, text, char, date, enum, uuid, etc.)
    return "string";
  }
}
