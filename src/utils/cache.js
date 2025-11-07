export class TTLCache {
  constructor(defaultTtlMs) {
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }
  set(key, value, ttlMs) {
    const exp = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.store.set(key, { value, exp });
  }
  get(key) {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.store.delete(key); return undefined; }
    return e.value;
  }
  del(key) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
