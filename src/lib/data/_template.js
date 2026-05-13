// src/lib/data/_template.js
//
// COPY THIS FILE when adding a new entity to the data layer.
//
// Steps to add a new entity (e.g., "Friendship"):
//   1. cp src/lib/data/_template.js src/lib/data/friendships.js
//   2. Find/replace `__ENTITY__` with the Base44 entity name (e.g., 'Friendship')
//   3. Adjust the function bodies if the entity has unusual fields/queries
//   4. Add `export * as friendships from './friendships';` to src/lib/data/index.js
//   5. Add the entity to BACKEND_CONTRACT.md § 3 with its field list
//   6. Add the file to BACKEND_CONTRACT.md § 7 migration log
//
// All five functions below are part of the standard contract. Omit `purgeForUser`
// only if the entity is shared across users (like ExerciseForm).

import { db } from '@/api/db';

const ENTITY = '__ENTITY__';
const e = () => db.entities[ENTITY];

/** List records owned by `email`, newest first. */
export const list = (email, limit = 50) =>
  e().filter({ created_by: email }, '-created_date', limit);

/** Create a new record. Returns the saved object. */
export const create = (data) => e().create(data);

/** Partial update by id. */
export const update = (id, data) => e().update(id, data);

/** Delete by id. */
export const remove = (id) => e().delete(id);

/**
 * Cascade-delete every record owned by `email`. Used by account deletion.
 * Best-effort, paginated, idempotent. Errors are swallowed so a single
 * record failure doesn't strand the user mid-deletion.
 */
export const purgeForUser = async (email) => {
  if (!email) return;
  const PAGE = 100;
  let total = 0;
   
  while (true) {
    const batch = await e()
      .filter({ created_by: email }, '-created_date', PAGE)
      .catch(() => []);
    if (!batch || batch.length === 0) break;
    await Promise.all(batch.map(r => e().delete(r.id).catch(() => {})));
    total += batch.length;
    if (batch.length < PAGE || total > 5000) break;
  }
};