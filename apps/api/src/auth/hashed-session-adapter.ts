import { createHash } from 'node:crypto';
import type { BetterAuthOptions, DBAdapter, DBTransactionAdapter, Where } from 'better-auth';

/**
 * Better Auth stores session tokens in plain text (ADR-0004). This wrapper around the database
 * adapter makes it store only `hashSessionToken(token)` instead:
 *
 * - every `token` value in `data` and in `where` clauses of the `session` model is hashed;
 * - rows come back with the raw token when the caller supplied it (create, or lookup by the
 *   cookie token), and with `REDACTED_SESSION_TOKEN` otherwise;
 * - querying by `REDACTED_SESSION_TOKEN` throws, so code that reuses a token read from storage
 *   fails loudly instead of silently matching nothing.
 */

const SESSION_MODEL = 'session';
const TOKEN_FIELD = 'token';

export const REDACTED_SESSION_TOKEN = 'redacted:session-token-is-not-stored';

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

type AdapterFactory = (options: BetterAuthOptions) => DBAdapter;
type Row = Record<string, unknown>;

export function withHashedSessionTokens(factory: AdapterFactory): AdapterFactory {
  return (options) => wrapAdapter(factory(options));
}

function wrapAdapter<A extends DBAdapter | DBTransactionAdapter>(base: A): A {
  const wrapped: DBTransactionAdapter = {
    ...base,
    async create<T extends Row, R = T>(input: Parameters<DBAdapter['create']>[0]) {
      if (input.model !== SESSION_MODEL) return base.create<T, R>(input as never);
      const data = input.data as Row;
      const raw = data[TOKEN_FIELD];
      if (typeof raw !== 'string') throw new Error('Session create without a token');
      const created = await base.create<T, R>({
        ...input,
        data: { ...data, [TOKEN_FIELD]: hashSessionToken(raw) } as unknown as Omit<T, 'id'>,
      });
      return restoreTokens(created, new Map([[hashSessionToken(raw), raw]]));
    },
    async findOne<T>(input: Parameters<DBAdapter['findOne']>[0]) {
      if (input.model !== SESSION_MODEL) return base.findOne<T>(input);
      const { where, known } = hashWhere(input.where);
      return restoreTokens(await base.findOne<T>({ ...input, where }), known);
    },
    async findMany<T>(input: Parameters<DBAdapter['findMany']>[0]) {
      if (input.model !== SESSION_MODEL) return base.findMany<T>(input);
      const { where, known } = hashWhere(input.where);
      const rows = await base.findMany<T>({ ...input, where });
      return rows.map((row) => restoreTokens(row, known));
    },
    async update<T>(input: Parameters<DBAdapter['update']>[0]) {
      if (input.model !== SESSION_MODEL) return base.update<T>(input);
      const { where, known } = hashWhere(input.where);
      const updated = await base.update<T>({ ...input, where, update: hashData(input.update) });
      return restoreTokens(updated, known);
    },
    async updateMany(input) {
      if (input.model !== SESSION_MODEL) return base.updateMany(input);
      return base.updateMany({
        ...input,
        where: hashWhere(input.where).where,
        update: hashData(input.update),
      });
    },
    async count(input) {
      if (input.model !== SESSION_MODEL) return base.count(input);
      return base.count({ ...input, where: hashWhere(input.where).where });
    },
    async delete(input) {
      if (input.model !== SESSION_MODEL) return base.delete(input);
      return base.delete({ ...input, where: hashWhere(input.where).where });
    },
    async deleteMany(input) {
      if (input.model !== SESSION_MODEL) return base.deleteMany(input);
      return base.deleteMany({ ...input, where: hashWhere(input.where).where });
    },
    async consumeOne<T>(input: Parameters<DBAdapter['consumeOne']>[0]) {
      if (input.model !== SESSION_MODEL) return base.consumeOne<T>(input);
      const { where, known } = hashWhere(input.where);
      return restoreTokens(await base.consumeOne<T>({ ...input, where }), known);
    },
    async incrementOne<T>(input: Parameters<DBAdapter['incrementOne']>[0]) {
      if (input.model !== SESSION_MODEL) return base.incrementOne<T>(input);
      const { where, known } = hashWhere(input.where);
      const result = await base.incrementOne<T>({
        ...input,
        where,
        set: input.set && hashData(input.set),
      });
      return restoreTokens(result, known);
    },
  };
  if ('transaction' in base) {
    const adapter = base as DBAdapter;
    return {
      ...wrapped,
      transaction: (callback) => adapter.transaction((trx) => callback(wrapAdapter(trx))),
    } as A;
  }
  return wrapped as A;
}

/** Hashes token values in a `where` clause and remembers hash -> raw for the results. */
function hashWhere(where: Where[] | undefined): { where: Where[]; known: Map<string, string> } {
  const known = new Map<string, string>();
  const hashOne = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Session token filter must be a string');
    if (value === REDACTED_SESSION_TOKEN) {
      throw new Error('Session tokens read from storage are redacted and cannot be queried');
    }
    const hash = hashSessionToken(value);
    known.set(hash, value);
    return hash;
  };
  const hashed = (where ?? []).map((clause) => {
    if (clause.field !== TOKEN_FIELD) return clause;
    const value = Array.isArray(clause.value) ? clause.value.map(hashOne) : hashOne(clause.value);
    return { ...clause, value } as Where;
  });
  return { where: hashed, known };
}

function hashData(data: Row): Row {
  const raw = data[TOKEN_FIELD];
  if (raw === undefined) return data;
  if (typeof raw !== 'string') throw new Error('Session token must be a string');
  return { ...data, [TOKEN_FIELD]: hashSessionToken(raw) };
}

function restoreTokens<T>(row: T, known: ReadonlyMap<string, string>): T {
  if (row === null || typeof row !== 'object') return row;
  const record = row as Row;
  const stored = record[TOKEN_FIELD];
  if (typeof stored !== 'string') return row;
  return { ...record, [TOKEN_FIELD]: known.get(stored) ?? REDACTED_SESSION_TOKEN } as T;
}
