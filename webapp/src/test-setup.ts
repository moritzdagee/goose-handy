// Node 25 ships its own experimental global localStorage, which hides the
// jsdom one and has no working methods without --localstorage-file. Install
// a small in-memory Storage so tests behave like a browser on any Node.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value: store, configurable: true, writable: true });
  Object.defineProperty(window, name, { value: store, configurable: true, writable: true });
}
