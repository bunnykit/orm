type CollectionKey = string | number | symbol;

type CollectionPredicate<T> = (item: T, index: number) => boolean;

function valueFor(item: any, key: CollectionKey): any {
  if (typeof key === "symbol") return item?.[key];
  const path = String(key);
  if (!path.includes(".")) {
    if (item && typeof item.getAttribute === "function") {
      const value = item.getAttribute(path);
      if (value !== undefined) return value;
    }
    return item?.[path];
  }
  return path.split(".").reduce((value, part) => {
    if (value && typeof value.getAttribute === "function") {
      const attribute = value.getAttribute(part);
      if (attribute !== undefined) return attribute;
    }
    return value?.[part];
  }, item);
}

function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a > b ? 1 : -1;
}

export class Collection<T = any> extends Array<T> {
  constructor(items?: Iterable<T> | ArrayLike<T> | number) {
    if (typeof items === "number") {
      super(items);
      return;
    }
    super();
    if (items) {
      this.push(...Array.from(items as Iterable<T> | ArrayLike<T>));
    }
  }

  static make<T>(items?: Iterable<T> | ArrayLike<T> | null): Collection<T> {
    return new Collection<T>(items || []);
  }

  all(): T[] {
    return Array.from(this);
  }

  toArray(): T[] {
    return this.all();
  }

  toJSON(): any[] {
    return this.map((item: any) => typeof item?.toJSON === "function" ? item.toJSON() : item);
  }

  isEmpty(): boolean {
    return this.length === 0;
  }

  isNotEmpty(): boolean {
    return this.length > 0;
  }

  first(predicate?: CollectionPredicate<T>, defaultValue: T | null = null): T | null {
    if (!predicate) return this[0] ?? defaultValue;
    for (let index = 0; index < this.length; index++) {
      const item = this[index];
      if (predicate(item, index)) return item;
    }
    return defaultValue;
  }

  last(predicate?: CollectionPredicate<T>, defaultValue: T | null = null): T | null {
    if (!predicate) return this.length > 0 ? this[this.length - 1] : defaultValue;
    for (let index = this.length - 1; index >= 0; index--) {
      const item = this[index];
      if (predicate(item, index)) return item;
    }
    return defaultValue;
  }

  get(index: number, defaultValue: T | null = null): T | null {
    return index in this ? this[index] : defaultValue;
  }

  each(callback: (item: T, index: number) => void): this {
    this.forEach(callback);
    return this;
  }

  reject(predicate: CollectionPredicate<T>): Collection<T> {
    return new Collection(this.filter((item, index) => !predicate(item, index)));
  }

  pluck<K extends CollectionKey>(key: K): Collection<any> {
    return new Collection(this.map((item) => valueFor(item, key)));
  }

  keyBy<K extends CollectionKey>(key: K | ((item: T, index: number) => CollectionKey)): Record<string, T> {
    return this.reduce<Record<string, T>>((result, item, index) => {
      const value = typeof key === "function" ? key(item, index) : valueFor(item, key);
      result[String(value)] = item;
      return result;
    }, {});
  }

  groupBy<K extends CollectionKey>(key: K | ((item: T, index: number) => CollectionKey)): Record<string, Collection<T>> {
    return this.reduce<Record<string, Collection<T>>>((result, item, index) => {
      const value = typeof key === "function" ? key(item, index) : valueFor(item, key);
      const groupKey = String(value);
      if (!result[groupKey]) result[groupKey] = new Collection<T>();
      result[groupKey].push(item);
      return result;
    }, {});
  }

  sortBy<K extends CollectionKey>(key: K | ((item: T) => any)): Collection<T> {
    return new Collection(this.all().sort((a, b) => {
      const aValue = typeof key === "function" ? key(a) : valueFor(a, key);
      const bValue = typeof key === "function" ? key(b) : valueFor(b, key);
      return compareValues(aValue, bValue);
    }));
  }

  sortByDesc<K extends CollectionKey>(key: K | ((item: T) => any)): Collection<T> {
    return new Collection(this.sortBy(key).reverse());
  }

  take(count: number): Collection<T> {
    return count >= 0 ? new Collection(this.slice(0, count)) : new Collection(this.slice(count));
  }

  skip(count: number): Collection<T> {
    return new Collection(this.slice(count));
  }

  where<K extends CollectionKey>(key: K, value: any): Collection<T> {
    return new Collection(this.filter((item) => valueFor(item, key) === value));
  }

  whereIn<K extends CollectionKey>(key: K, values: any[]): Collection<T> {
    const set = new Set(values);
    return new Collection(this.filter((item) => set.has(valueFor(item, key))));
  }

  contains(value: T): boolean;
  contains(predicate: CollectionPredicate<T>): boolean;
  contains<K extends CollectionKey>(key: K, value: any): boolean;
  contains(keyOrValue: any, value?: any): boolean {
    if (typeof keyOrValue === "function") {
      return this.some(keyOrValue);
    }
    if (arguments.length === 2) {
      return this.some((item) => valueFor(item, keyOrValue) === value);
    }
    return this.includes(keyOrValue);
  }

  firstWhere<K extends CollectionKey>(key: K, value: any): T | null {
    return this.first((item) => valueFor(item, key) === value);
  }

  count(): number {
    return this.length;
  }

  sum<K extends CollectionKey>(key?: K | ((item: T) => any)): number {
    return this.reduce((total, item) => {
      const value = key === undefined ? item : typeof key === "function" ? key(item) : valueFor(item, key);
      return total + Number(value || 0);
    }, 0);
  }

  avg<K extends CollectionKey>(key?: K | ((item: T) => any)): number {
    return this.length === 0 ? 0 : this.sum(key as any) / this.length;
  }

  min<K extends CollectionKey>(key?: K | ((item: T) => any)): any {
    if (this.length === 0) return null;
    return this.reduce<any>((minValue, item) => {
      const value = key === undefined ? item : typeof key === "function" ? key(item) : valueFor(item, key);
      return compareValues(value, minValue) < 0 ? value : minValue;
    }, key === undefined ? this[0] : typeof key === "function" ? key(this[0]) : valueFor(this[0], key));
  }

  max<K extends CollectionKey>(key?: K | ((item: T) => any)): any {
    if (this.length === 0) return null;
    return this.reduce<any>((maxValue, item) => {
      const value = key === undefined ? item : typeof key === "function" ? key(item) : valueFor(item, key);
      return compareValues(value, maxValue) > 0 ? value : maxValue;
    }, key === undefined ? this[0] : typeof key === "function" ? key(this[0]) : valueFor(this[0], key));
  }
}

export function collect<T>(items?: Iterable<T> | ArrayLike<T> | null): Collection<T> {
  return Collection.make(items);
}
