import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ENTITIES = [
  'WorkoutLog',
  'Regimen',
  'Goal',
  'BodyMetric',
  'ChatSession',
  'NutritionLog',
  'WorkoutTemplate',
  // Achievement was missing from this list. resetForDeletion clears
  // user_profiles.achievements_unlocked_count to 0, but pre-reset
  // Achievement rows persisted forever. When a re-onboarded user
  // logged their first workout, updateUserXpAndAchievements found
  // the old "first_workout" row and skipped the re-unlock, so the
  // user never got the corresponding milestone capsule grant a
  // second time. Adding it here clears the slate.
  'Achievement',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const resetAt = user.account_reset_at;
    if (!resetAt) {
      return Response.json({ success: true, skipped: true, reason: 'No reset timestamp' });
    }

    const resetTime = new Date(resetAt).getTime();
    const userEmail = user.email;
    let totalDeleted = 0;

    for (const entityName of ENTITIES) {
      try {
        const entity = base44.asServiceRole.entities[entityName];
        const records = await entity.filter({ created_by: userEmail }, '-created_date', 1000);
        const stale = records.filter(r => {
          if (!r?.created_date) return false;
          return new Date(r.created_date).getTime() < resetTime;
        });
        for (const r of stale) {
          try {
            await entity.delete(r.id);
            totalDeleted++;
          } catch {
            // Silent — will retry next session
          }
        }
      } catch (err) {
        console.error(`cleanupAfterReset ${entityName}:`, err?.message || err);
      }
    }

    return Response.json({ success: true, deleted: totalDeleted });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
});