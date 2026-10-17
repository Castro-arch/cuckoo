import type { BetterAuthOptions, DBAdapter, DBTransactionAdapter, Where } from 'better-auth';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  hashSessionToken,
  REDACTED_SESSION_TOKEN,
  withHashedSessionTokens,
} from './hashed-session-adapter.js';

type Row = Record<string, unknown>;

/** Minimal in-memory adapter: eq and in operators, enough to observe what gets stored. */
function memoryAdapter(store: Map<string, Row[]>): DBAdapter {
  const rows = (model: string) => {
    if (!store.has(model)) store.set(model, []);
    return store.get(model)!;
  };
  const matches = (row: Row, where: Where[] = []) =>
    where.every((clause) =>
      clause.operator === 'in'
        ? (clause.value as unknown[]).includes(row[clause.field])
        : row[clause.field] === clause.value,
    );
  const adapter: DBTransactionAdapter = {
    id: 'memory',
    async create({ model, data }) {
      const row = { id: `id-${rows(model).length + 1}`, ...(data as Row) };
      rows(model).push(row);
      return { ...row } as never;
    },
    async findOne({ model, where }) {
      const row = rows(model).find((r) => matches(r, where));
      return (row ? { ...row } : null) as never;
    },
    async findMany({ model, where }) {
      return rows(model)
        .filter((r) => matches(r, where))
        .map((r) => ({ ...r })) as never;
    },
    async count({ model, where }) {
      return rows(model).filter((r) => matches(r, where)).length;
    },
    async update({ model, where, update }) {
      const row = rows(model).find((r) => matches(r, where));
      if (!row) return null;
      Object.assign(row, update);
      return { ...row } as never;
    },
    async updateMany({ model, where, update }) {
      const found = rows(model).filter((r) => matches(r, where));
      found.forEach((r) => Object.assign(r, update));
      return found.length;
    },
    async delete({ model, where }) {
      store.set(
        model,
        rows(model).filter((r) => !matches(r, where)),
      );
    },
    async deleteMany({ model, where }) {
      const before = rows(model).length;
      store.set(
        model,
        rows(model).filter((r) => !matches(r, where)),
      );
      return before - rows(model).length;
    },
    async consumeOne({ model, where }) {
      const row = rows(model).find((r) => matches(r, where));
      if (!row) return null;
      store.set(
        model,
        rows(model).filter((r) => r !== row),
      );
      return { ...row } as never;
    },
    async incrementOne({ model, where, increment, set }) {
      const row = rows(model).find((r) => matches(r, where));
      if (!row) return null;
      for (const [field, delta] of Object.entries(increment)) {
        row[field] = (row[field] as number) + delta;
      }
      Object.assign(row, set);
      return { ...row } as never;
    },
  } as DBTransactionAdapter;
  return { ...adapter, transaction: (callback) => callback(adapter) } as DBAdapter;
}

const RAW = 'raw-session-token-from-cookie';

describe('withHashedSessionTokens', () => {
  let store: Map<string, Row[]>;
  let adapter: DBAdapter;

  beforeEach(() => {
    store = new Map();
    adapter = withHashedSessionTokens(() => memoryAdapter(store))({} as BetterAuthOptions);
  });

  const createSession = () =>
    adapter.create<Row>({ model: 'session', data: { token: RAW, userId: 'u1' } });

  it('stores only the hash, and returns the raw token to the creator', async () => {
    const created = await createSession();

    expect(created.token).toBe(RAW);
    expect(store.get('session')![0]!.token).toBe(hashSessionToken(RAW));
    expect(JSON.stringify([...store.values()])).not.toContain(RAW);
  });

  it('finds a session by the raw token and returns the raw token', async () => {
    await createSession();

    const found = await adapter.findOne<Row>({
      model: 'session',
      where: [{ field: 'token', value: RAW }],
    });

    expect(found).toMatchObject({ token: RAW, userId: 'u1' });
  });

  it('does not find a session by its stored hash', async () => {
    await createSession();

    const found = await adapter.findOne<Row>({
      model: 'session',
      where: [{ field: 'token', value: hashSessionToken(RAW) }],
    });

    expect(found).toBeNull();
  });

  it('redacts tokens in rows read without the raw token', async () => {
    await createSession();

    const rows = await adapter.findMany<Row>({
      model: 'session',
      where: [{ field: 'userId', value: 'u1' }],
    });

    expect(rows.map((r) => r.token)).toEqual([REDACTED_SESSION_TOKEN]);
  });

  it('maps every token of an "in" filter back to its raw value', async () => {
    await adapter.create({ model: 'session', data: { token: 'a', userId: 'u1' } });
    await adapter.create({ model: 'session', data: { token: 'b', userId: 'u1' } });

    const rows = await adapter.findMany<Row>({
      model: 'session',
      where: [{ field: 'token', operator: 'in', value: ['a', 'b'] }],
    });

    expect(rows.map((r) => r.token).sort()).toEqual(['a', 'b']);
  });

  it('throws when a redacted token is used in a query', async () => {
    await createSession();

    await expect(
      adapter.delete({
        model: 'session',
        where: [{ field: 'token', value: REDACTED_SESSION_TOKEN }],
      }),
    ).rejects.toThrow(/redacted/);
  });

  it('updates and deletes by the raw token', async () => {
    await createSession();

    const updated = await adapter.update<Row>({
      model: 'session',
      where: [{ field: 'token', value: RAW }],
      update: { expiresAt: 'later' },
    });
    expect(updated).toMatchObject({ token: RAW, expiresAt: 'later' });

    await adapter.delete({ model: 'session', where: [{ field: 'token', value: RAW }] });
    expect(store.get('session')).toEqual([]);
  });

  it('hashes tokens inside transactions too', async () => {
    await adapter.transaction((trx) =>
      trx.create({ model: 'session', data: { token: RAW, userId: 'u1' } }),
    );

    expect(store.get('session')![0]!.token).toBe(hashSessionToken(RAW));
  });

  it('leaves other models untouched', async () => {
    await adapter.create({ model: 'verification', data: { token: RAW, identifier: 'x' } });

    expect(store.get('verification')![0]!.token).toBe(RAW);
  });
});
