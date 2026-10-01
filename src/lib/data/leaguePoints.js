// src/lib/data/leaguePoints.js
//
// League points are the weekly XP a bracket ranks on after training days.
// Everything here is credited by the SERVER (migration 20261001170000) from
// rows it can read; the client only asks it to look.
//
//   syncMyLoggingPoints()  photo meals, barcode meals and the daily water
//                          goal for today. Idempotent: call it after any
//                          nutrition save and it pays only what is new.
//   getMyLeagueQuests()    this league week's quests with server progress.
//   claimLeagueQuest(id)   pays a met quest once per week.

import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';

export async function syncMyLoggingPoints() {
  try {
    const { data, error } = await supabase.rpc('sync_my_logging_points');
    if (error) {
      // 42883: host predates the migration. Nothing to credit yet.
      if (error.code !== '42883') reportError(error, { feature: 'leaguePoints.sync', level: 'warning' });
      return null;
    }
    return data || null;
  } catch (err) {
    reportError(err, { feature: 'leaguePoints.sync-throw', level: 'warning' });
    return null;
  }
}

export async function getMyLeagueQuests() {
  const { data, error } = await supabase.rpc('get_my_league_quests');
  if (error) {
    if (error.code === '42883') return null;
    throw error;
  }
  return data || null;
}

export async function claimLeagueQuest(questId) {
  const { data, error } = await supabase.rpc('claim_league_quest', { p_quest_id: questId });
  if (error) throw error;
  return data || { success: false, xp_awarded: 0 };
}
