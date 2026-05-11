// src/lib/data/serverFunctions.js
// Wrapped server-side function invocations.
// On migration: replace the body with calls to the new backend's RPC layer
// (e.g., Firebase Cloud Functions, Supabase Edge Functions, REST endpoints).
import { db } from '@/api/db';

/**
 * Awards XP and recomputes achievements for the current user after an action.
 * Atomic on the server. Required: this MUST be atomic on the migration target —
 * client-side increment patterns produce drift under concurrent saves.
 */
export const updateUserXpAndAchievements = ({ xp_gained, action_type, action_data }) =>
  db.functions.invoke('updateUserXpAndAchievements', { xp_gained, action_type, action_data });

/**
 * Server-side account-data deletion. Called as a backstop after the client
 * cascade-deletes everything. On migration: this should be the SOLE deletion
 * path — the client doesn't need cascade logic if the server handles it.
 */
export const deleteAccountData = () =>
  db.functions.invoke('deleteAccountData', {});