import type { Redis } from 'ioredis';

/**
 * An in-memory stand-in for ioredis.
 *
 * The suite must not require a live Redis (CI has none, and a developer with
 * Docker stopped should still be able to run tests), but presence, room
 * membership and the meeting cache are all genuinely Redis-backed - stubbing
 * them out individually would mean the tests never exercise the real code
 * paths.
 *
 * Only the commands this codebase actually issues are implemented. Anything
 * else is deliberately absent so it fails loudly as "not a function" rather
 * than silently returning undefined and producing a confusing assertion
 * failure somewhere downstream.
 */
export interface FakeRedis {
  store: Map<string, string>;
  sets: Map<string, Set<string>>;
  hashes: Map<string, Map<string, string>>;
  reset(): void;
}

export function createFakeRedis(): Redis & FakeRedis {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();

  const set = (key: string) => {
    const existing = sets.get(key);
    if (existing) return existing;
    const created = new Set<string>();
    sets.set(key, created);
    return created;
  };

  const hash = (key: string) => {
    const existing = hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    hashes.set(key, created);
    return created;
  };

  const fake = {
    status: 'ready',

    // --- connection ---
    ping: async () => 'PONG',
    quit: async () => 'OK',
    // The Socket.io Redis adapter duplicates the client; tests never attach
    // the adapter, but returning a fresh instance keeps the shape honest.
    duplicate: () => createFakeRedis(),

    // --- strings (meeting cache) ---
    // TTLs are accepted and ignored: nothing in the suite depends on an entry
    // expiring, and a test that waited for one would be slow and flaky.
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    del: async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
        if (sets.delete(key)) removed += 1;
        if (hashes.delete(key)) removed += 1;
      }
      return removed;
    },
    expire: async () => 1,
    // Analytics cache generations.
    incr: async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    },

    // --- sets (presence) ---
    sadd: async (key: string, ...members: string[]) => {
      const target = set(key);
      let added = 0;
      for (const member of members) {
        if (!target.has(member)) {
          target.add(member);
          added += 1;
        }
      }
      return added;
    },
    srem: async (key: string, ...members: string[]) => {
      const target = sets.get(key);
      if (!target) return 0;
      let removed = 0;
      for (const member of members) {
        if (target.delete(member)) removed += 1;
      }
      return removed;
    },
    scard: async (key: string) => sets.get(key)?.size ?? 0,
    smembers: async (key: string) => [...(sets.get(key) ?? [])],

    // --- hashes (room participants) ---
    hset: async (key: string, field: string, value: string) => {
      const target = hash(key);
      const isNew = !target.has(field);
      target.set(field, value);
      return isNew ? 1 : 0;
    },
    hget: async (key: string, field: string) => hashes.get(key)?.get(field) ?? null,
    hdel: async (key: string, ...fields: string[]) => {
      const target = hashes.get(key);
      if (!target) return 0;
      let removed = 0;
      for (const field of fields) {
        if (target.delete(field)) removed += 1;
      }
      return removed;
    },
    hgetall: async (key: string) => Object.fromEntries(hashes.get(key) ?? new Map()),

    // --- test helpers ---
    store,
    sets,
    hashes,
    reset() {
      store.clear();
      sets.clear();
      hashes.clear();
    },
  };

  // One cast, confined to this file: the real `Redis` type has hundreds of
  // methods, and enumerating the ones we do not implement would add noise
  // without adding safety.
  return fake as unknown as Redis & FakeRedis;
}
