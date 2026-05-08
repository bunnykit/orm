export function snakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

export function normalizePathList(value?: string | string[]): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}
