// supabase/functions/generateWeeklyDebriefs/index.ts
//
// Generates a weekly debrief record for every user who had activity in the
// past week. Invoked by a pg_cron job every Sunday at 20:00 UTC.
//
// ── Auth ────────────────────────────────────────────────────────────────────
//   Pass either:
//     • Authorization: Bearer <service_role_jwt>   (admin / manual trigger)
//     • X-Cron-Secret: <DEBRIEF_CRON_SECRET>       (pg_cron trigger)
//
// ── Env secrets needed ──────────────────────────────────────────────────────
//   SUPABASE_URL                — auto-provided by the runtime
//   SUPABASE_SERVICE_ROLE_KEY   — auto-provided by the runtime
//   DEBRIEF_CRON_SECRET         — shared secret for pg_cron caller
//   SEND_PUSH_TRIGGER_SECRET    — shared secret to call send-push function
//   ANTHROPIC_API_KEY           — optional; enables AI insight generation
//
// ── Data shape (data JSONB column) ──────────────────────────────────────────
// {
//   week_start, week_end,
//   volume_lbs, volume_prev_lbs, volume_change_pct,
//   top_lift_name, top_lift_weight, top_lift_reps, top_lift_is_pr,
//   workout_streak, workouts_count,
//   macro_days_tracked, macro_days_on_target, macro_adherence_pct,
//   muscle_groups_trained[], muscle_groups_neglected[],
//   ai_insight,
//   xp_earned, total_xp_end, level_start, level_end
// }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

// ── ISO week helpers ─────────────────────────────────────────────────────────

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday of the current week (ISO weeks start Monday, anchored on Thursday)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function getWeekRange(date: Date): { start: string; end: string } {
  const day = date.getUTCDay(); // 0 = Sunday
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { start: fmt(monday), end: fmt(sunday) };
}

// ── XP formula (mirrors src/lib/xpSystem.js) ────────────────────────────────

function estimateWorkoutXp(workout: Record<string, unknown>): number {
  const exercises = (workout.exercises as Array<Record<string, unknown>>) || [];
  let setCount = 0;
  let repXp = 0;
  const volume = Number(workout.total_volume) || 0;
  const duration = Number(workout.duration_min) || 0;

  for (const ex of exercises) {
    const sets = (ex.sets as Array<Record<string, unknown>>) || [];
    setCount += sets.length;
    for (const set of sets) {
      const reps = Number(set.reps) || 0;
      repXp += reps >= 12 ? 6 : reps >= 8 ? 4 : reps >= 5 ? 3 : 2;
    }
  }

  const raw = setCount * 12 + repXp + Math.floor(volume / 400) + Math.floor(duration / 10) * 4;
  return Math.min(raw, 1000);
}

function levelFromXp(totalXp: number): number {
  const BASE_XP = 150;
  const getMultiplier = (lvl: number) =>
    lvl <= 10 ? 1.0 : lvl <= 25 ? 1.3 : lvl <= 50 ? 1.6 : lvl <= 75 ? 2.0 : 2.5;

  let level = 1;
  let cumulative = 0;
  while (level <= 200) {
    const needed = Math.round(BASE_XP * getMultiplier(level));
    if (cumulative + needed > totalXp) break;
    cumulative += needed;
    level++;
  }
  return level;
}

// ── Muscle group keyword matching ────────────────────────────────────────────

const MUSCLE_KEYWORDS: Record<string, string[]> = {
  chest:    ['bench press', 'chest fly', 'push-up', 'pushup', 'incline', 'decline', 'dip', 'pec'],
  back:     ['row', 'pull-up', 'pullup', 'lat pulldown', 'deadlift', 'rdl', 'pulldown', 'cable row'],
  shoulders:['shoulder press', 'lateral raise', 'front raise', 'overhead', 'ohp', 'military', 'arnold', 'rear delt', 'face pull'],
  biceps:   ['curl', 'bicep', 'hammer'],
  triceps:  ['tricep', 'pushdown', 'skull crusher', 'close grip'],
  legs:     ['squat', 'leg press', 'lunge', 'leg extension', 'leg curl', 'calf raise', 'step up'],
  glutes:   ['hip thrust', 'glute', 'bulgarian', 'sumo'],
  core:     ['plank', 'crunch', 'sit-up', 'ab ', 'core', 'russian twist', 'leg raise'],
};
const ALL_MUSCLE_GROUPS = Object.keys(MUSCLE_KEYWORDS);

function detectMuscleGroups(workouts: Array<Record<string, unknown>>): {
  trained: string[];
  neglected: string[];
} {
  const trained = new Set<string>();
  for (const w of workouts) {
    for (const ex of ((w.exercises as Array<Record<string, unknown>>) || [])) {
      const name = ((ex.name || ex.exerciseName || '') as string).toLowerCase();
      for (const [group, keywords] of Object.entries(MUSCLE_KEYWORDS)) {
        if (keywords.some(kw => name.includes(kw))) trained.add(group);
      }
    }
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    trained: [...trained].map(cap),
    neglected: ALL_MUSCLE_GROUPS.filter(g => !trained.has(g)).map(cap),
  };
}

// ── Rule-based AI insight fallback ───────────────────────────────────────────

function ruleBasedInsight(params: {
  workoutsCount: number;
  topLiftName: string;
  topLiftIsPr: boolean;
  volumeChangePct: number | null;
  muscleGroupsNeglected: string[];
  macroDaysTracked: number;
}): string {
  const { workoutsCount, topLiftName, topLiftIsPr, volumeChangePct, muscleGroupsNeglected, macroDaysTracked } = params;

  if (workoutsCount === 0) {
    return 'No workouts logged this week. Every champion has rest weeks — come back stronger next Sunday.';
  }
  if (topLiftIsPr && topLiftName) {
    return `New PR on ${topLiftName}! Progressive overload is working — keep pushing those numbers up.`;
  }
  if (volumeChangePct !== null && volumeChangePct >= 15) {
    return `Volume up ${volumeChangePct}% this week — impressive push. Prioritize sleep and nutrition to sustain this momentum.`;
  }
  if (volumeChangePct !== null && volumeChangePct <= -15) {
    return `Lighter week — sometimes that's exactly what the body needs. Come back recharged next week.`;
  }
  if (muscleGroupsNeglected.length >= 4) {
    return `Consider adding ${muscleGroupsNeglected.slice(0, 2).join(' and ')} work next week for more balanced development.`;
  }
  if (macroDaysTracked >= 6) {
    return `${workoutsCount} session${workoutsCount > 1 ? 's' : ''} completed with great nutrition consistency. Keep stacking those habits.`;
  }
  return `${workoutsCount} session${workoutsCount > 1 ? 's' : ''} in the books. Consistency is your superpower — keep showing up.`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
  }

  // Auth: accept Bearer JWT or shared cron secret
  const cronSecret = Deno.env.get('DEBRIEF_CRON_SECRET') || '';
  const incoming  = req.headers.get('x-cron-secret') || '';
  const auth      = req.headers.get('authorization') || '';
  const hasBearer = /^Bearer\s+\S+/i.test(auth);
  const hasCron   = cronSecret.length > 0 && incoming === cronSecret;

  if (!hasBearer && !hasCron) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const now = new Date();
  const { start: weekStart, end: weekEnd } = getWeekRange(now);
  const { week: weekNumber, year } = getISOWeek(now);

  const prevWeekDate = new Date(now);
  prevWeekDate.setUTCDate(prevWeekDate.getUTCDate() - 7);
  const { start: prevStart, end: prevEnd } = getWeekRange(prevWeekDate);

  // ── Gather active users ────────────────────────────────────────────────────
  const [{ data: wkUsers }, { data: nutUsers }] = await Promise.all([
    supabase.from('workout_logs').select('user_id, created_by').gte('date', weekStart).lte('date', weekEnd),
    supabase.from('nutrition_logs').select('user_id, created_by').gte('date', weekStart).lte('date', weekEnd),
  ]);

  const userMap = new Map<string, string>(); // user_id → email
  for (const r of [...(wkUsers || []), ...(nutUsers || [])]) {
    if (r.user_id && !userMap.has(r.user_id)) userMap.set(r.user_id, r.created_by || '');
  }

  if (userMap.size === 0) {
    return new Response(JSON.stringify({ ok: true, generated: 0, reason: 'no_active_users' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Fetch profiles ─────────────────────────────────────────────────────────
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, email, total_xp, current_level, workout_streak')
    .in('id', [...userMap.keys()]);

  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  // ── Process each user ──────────────────────────────────────────────────────
  let generated = 0;
  const errors: string[] = [];

  for (const [userId, fallbackEmail] of userMap.entries()) {
    try {
      const profile = profileMap.get(userId);
      const email   = profile?.email || fallbackEmail;

      // Parallel data fetch for this user
      const [
        { data: weekWorkouts },
        { data: prevWorkouts },
        { data: historicWorkouts },
        { data: nutritionLogs },
      ] = await Promise.all([
        supabase.from('workout_logs')
          .select('exercises, total_volume, duration_min, date')
          .eq('user_id', userId).gte('date', weekStart).lte('date', weekEnd),
        supabase.from('workout_logs')
          .select('total_volume')
          .eq('user_id', userId).gte('date', prevStart).lte('date', prevEnd),
        supabase.from('workout_logs')
          .select('exercises')
          .eq('user_id', userId).lt('date', weekStart),
        supabase.from('nutrition_logs')
          .select('date, calories')
          .eq('user_id', userId).gte('date', weekStart).lte('date', weekEnd),
      ]);

      // ── Volume ────────────────────────────────────────────────────────────
      const volumeLbs     = (weekWorkouts || []).reduce((s, w) => s + (Number(w.total_volume) || 0), 0);
      const volumePrevLbs = (prevWorkouts  || []).reduce((s, w) => s + (Number(w.total_volume) || 0), 0);
      const volumeChangePct = volumePrevLbs > 0
        ? Math.round(((volumeLbs - volumePrevLbs) / volumePrevLbs) * 100)
        : null;

      // ── All-time bests (for PR detection) ────────────────────────────────
      const allTimeBests: Record<string, number> = {};
      for (const w of (historicWorkouts || [])) {
        for (const ex of ((w.exercises as Array<Record<string, unknown>>) || [])) {
          const name = ((ex.name || ex.exerciseName || '') as string);
          if (!name) continue;
          for (const set of ((ex.sets as Array<Record<string, unknown>>) || [])) {
            const wt = Number(set.weight) || 0;
            if (!allTimeBests[name] || wt > allTimeBests[name]) allTimeBests[name] = wt;
          }
        }
      }

      // ── Top lift this week ────────────────────────────────────────────────
      let topLiftName = '';
      let topLiftWeight = 0;
      let topLiftReps = 0;
      let topLiftIsPr = false;

      for (const w of (weekWorkouts || [])) {
        for (const ex of ((w.exercises as Array<Record<string, unknown>>) || [])) {
          const name = ((ex.name || ex.exerciseName || '') as string);
          if (!name) continue;
          for (const set of ((ex.sets as Array<Record<string, unknown>>) || [])) {
            const wt   = Number(set.weight) || 0;
            const reps = Number(set.reps)   || 0;
            if (wt > topLiftWeight) {
              topLiftWeight = wt;
              topLiftReps   = reps;
              topLiftName   = name;
              topLiftIsPr   = !allTimeBests[name] || wt > allTimeBests[name];
            }
          }
        }
      }

      // ── Muscle groups ─────────────────────────────────────────────────────
      const { trained: muscleGroupsTrained, neglected: muscleGroupsNeglected } =
        detectMuscleGroups((weekWorkouts || []) as Array<Record<string, unknown>>);

      // ── Macro adherence ───────────────────────────────────────────────────
      // Count days where user logged ≥ 1200 kcal (proxy for "on target" day)
      const dayCalories: Record<string, number> = {};
      for (const log of (nutritionLogs || [])) {
        const d = log.date as string;
        dayCalories[d] = (dayCalories[d] || 0) + (Number(log.calories) || 0);
      }
      const macroDaysTracked  = Object.keys(dayCalories).length;
      const macroDaysOnTarget = Object.values(dayCalories).filter(c => c >= 1200).length;
      const macroAdherencePct = Math.round((macroDaysOnTarget / 7) * 100);

      // ── XP ────────────────────────────────────────────────────────────────
      const workoutXp   = (weekWorkouts  || []).reduce((s, w) => s + estimateWorkoutXp(w as Record<string, unknown>), 0);
      const nutritionXp = (nutritionLogs || []).length * 5;
      const xpEarned    = workoutXp + nutritionXp;
      const totalXpEnd  = profile?.total_xp || 0;
      const levelEnd    = levelFromXp(totalXpEnd);
      const levelStart  = levelFromXp(Math.max(0, totalXpEnd - xpEarned));

      // ── Week label ────────────────────────────────────────────────────────
      const weekLabel     = `Week ${weekNumber}, ${year}`;
      const workoutsCount = (weekWorkouts || []).length;
      const workoutStreak = profile?.workout_streak || 0;

      // ── AI insight ────────────────────────────────────────────────────────
      let aiInsight = '';
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (anthropicKey && workoutsCount > 0) {
        try {
          const prompt = [
            'You are a motivating fitness coach. Write 1-2 sentences (max 35 words) of personalized insight.',
            `This week: ${workoutsCount} workout(s), ${Math.round(volumeLbs)} lbs total volume`,
            volumeChangePct !== null ? `(${volumeChangePct >= 0 ? '+' : ''}${volumeChangePct}% vs last week)` : '(first tracked week)',
            topLiftName ? `Top lift: ${topLiftName} ${topLiftWeight} lbs${topLiftIsPr ? ' — NEW PR!' : ''}` : '',
            `Nutrition tracked: ${macroDaysTracked}/7 days`,
            muscleGroupsTrained.length > 0 ? `Muscles trained: ${muscleGroupsTrained.join(', ')}` : '',
            'Be specific, encouraging, and actionable.',
          ].filter(Boolean).join('. ');

          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 120,
              messages: [{ role: 'user', content: prompt }],
            }),
          });
          if (res.ok) {
            const json = await res.json() as { content?: Array<{ text: string }> };
            aiInsight = json.content?.[0]?.text?.trim() || '';
          }
        } catch (e) {
          console.warn('[debrief] AI insight failed, using fallback:', e);
        }
      }

      if (!aiInsight) {
        aiInsight = ruleBasedInsight({
          workoutsCount,
          topLiftName,
          topLiftIsPr,
          volumeChangePct,
          muscleGroupsNeglected,
          macroDaysTracked,
        });
      }

      // ── Build data JSONB ──────────────────────────────────────────────────
      const debriefData = {
        week_start:             weekStart,
        week_end:               weekEnd,
        volume_lbs:             Math.round(volumeLbs),
        volume_prev_lbs:        Math.round(volumePrevLbs),
        volume_change_pct:      volumeChangePct,
        top_lift_name:          topLiftName   || null,
        top_lift_weight:        topLiftWeight || null,
        top_lift_reps:          topLiftReps   || null,
        top_lift_is_pr:         topLiftIsPr,
        workout_streak:         workoutStreak,
        workouts_count:         workoutsCount,
        macro_days_tracked:     macroDaysTracked,
        macro_days_on_target:   macroDaysOnTarget,
        macro_adherence_pct:    macroAdherencePct,
        muscle_groups_trained:  muscleGroupsTrained,
        muscle_groups_neglected:muscleGroupsNeglected,
        ai_insight:             aiInsight,
        xp_earned:              xpEarned,
        total_xp_end:           totalXpEnd,
        level_start:            levelStart,
        level_end:              levelEnd,
      };

      // ── Upsert debrief row ────────────────────────────────────────────────
      const { error: upsertErr } = await supabase
        .from('weekly_debriefs')
        .upsert(
          { user_id: userId, user_email: email, week_number: weekNumber, year, week_label: weekLabel, data: debriefData },
          { onConflict: 'user_id,week_number,year' }
        );

      if (upsertErr) throw upsertErr;

      // ── Push notification ─────────────────────────────────────────────────
      const supabaseUrl   = Deno.env.get('SUPABASE_URL')!;
      const pushUrl       = `${supabaseUrl}/functions/v1/send-push`;
      const pushSecret    = Deno.env.get('SEND_PUSH_TRIGGER_SECRET') || '';
      if (pushSecret) {
        const pushBody = workoutsCount > 0
          ? `${workoutsCount} workout${workoutsCount > 1 ? 's' : ''} · ${Math.round(volumeLbs).toLocaleString()} lbs${topLiftIsPr ? ` · New PR on ${topLiftName}!` : ''}`
          : 'Your weekly summary is ready to review.';
        await fetch(pushUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-send-push-secret': pushSecret },
          body: JSON.stringify({
            user_id: userId,
            title: `🏋️ ${weekLabel} Debrief Ready`,
            body:  pushBody,
            url:   '/profile?debrief=true',
            tag:   `weekly-debrief-${weekNumber}-${year}`,
          }),
        }).catch(e => console.warn('[debrief] push failed:', e));
      }

      generated++;
    } catch (err) {
      console.error(`[debrief] error for user ${userId}:`, err);
      errors.push(userId);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, week: `${weekNumber}/${year}`, generated, failed: errors.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
