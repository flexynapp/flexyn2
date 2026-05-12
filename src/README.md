# Flexyn

A personal fitness companion app for tracking workouts, nutrition, and body metrics.

## ⚠️ Architecture: the data-access seam

The Base44 migration is complete. The data client is `src/api/db.js`
(Supabase-backed), but the same seam convention applies:
**all data access must go through `src/lib/data/*`** — never call
`db.entities.X`, `db.auth.X`, or `db.functions.invoke` directly from
components or pages.

The data layer keeps business logic platform-agnostic: a future
swap to a different backend would only need to rewrite files in
`src/lib/data/` (and the `src/api/db.js` adapter). Pages and
components are insulated.

See [`BACKEND_CONTRACT.md`](./BACKEND_CONTRACT.md) for:
- The complete entity / field schema
- Server-side RPCs (atomicity-critical multi-row state changes)
- The migration log

An ESLint rule fails the build on direct `db.*` access outside the
data layer — if you see that error, the fix is to use or extend the
appropriate `src/lib/data/<entity>.js` module.

## Getting started

Clone the repo and install dependencies:

```bash
npm install
npm run dev
``