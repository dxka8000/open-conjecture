// In-memory key/value store with the same interface as the Durable Object
// storage adapter: get, put, delete, and list(prefix) -> [[key, value], ...].

export class MemStore {
  #map = new Map();

  async get(key) {
    const v = this.#map.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async put(key, value) {
    this.#map.set(key, structuredClone(value));
  }

  async delete(key) {
    return this.#map.delete(key);
  }

  async list(prefix = '') {
    return [...this.#map.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((k) => [k, structuredClone(this.#map.get(k))]);
  }
}
