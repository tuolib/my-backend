export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

let cacheInstance: Cache;

export function setCache(c: Cache) {
  cacheInstance = c;
}

export function getCache() {
  if (!cacheInstance) throw new Error('Cache not initialized');
  return cacheInstance;
}
