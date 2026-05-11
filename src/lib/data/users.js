// src/lib/data/users.js
// Cross-user reads (leaderboards). Migration target: a server-side
// `getLeaderboard(metric, scope, region, limit)` function on the new
// backend that returns pre-sorted top-N. For now, lists all users and
// sorts client-side — fine up to ~5,000 users.
import { db } from '@/api/db';

export const list = () => db.entities.User.list();