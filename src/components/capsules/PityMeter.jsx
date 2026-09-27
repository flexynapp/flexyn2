// src/components/capsules/PityMeter.jsx
//
// Where the user stands against the epic pity guarantee, as one line (and an
// optional bar). The counter and the threshold both come from
// get_capsule_pity() (migration 256), never from a client constant: the UI
// may only promise what the server honours. See CapsuleStreak for the long
// version with the legendary counter and personal best.

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import * as capsules from '@/lib/data/capsules';
import { useLanguage } from '@/lib/LanguageContext';

export function pityReading(pity) {
  if (!pity || !pity.epic_at) return null;
  const since = Math.max(0, pity.since_epic ?? 0);
  const at = pity.epic_at;
  return { since: Math.min(since, at), at, left: Math.max(0, at - since) };
}

export default function PityMeter({ bar = false }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const { data: pity } = useQuery({
    queryKey: ['capsulePity', user?.email],
    queryFn: capsules.getPity,
    enabled: !!user?.email,
    staleTime: 30_000,
  });
  const r = pityReading(pity);
  // Pre-256 host or no data: the line is a promise, so say nothing rather
  // than guess.
  if (!r) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between gap-3 text-caption text-muted-foreground">
        <span>
          {r.left <= 1
            ? tFallback('capsules.pity.next', 'Epic or better on the next open')
            : tFallback('capsules.pity.within', 'Epic or better within {n} opens', { n: r.left })}
        </span>
        <span className="tabular-nums shrink-0">
          {tFallback('capsules.pity.count', '{since} of {at}', { since: r.since, at: r.at })}
        </span>
      </div>
      {bar && (
        <div className="h-1 rounded-full bg-border" aria-hidden="true">
          <div
            className="h-1 rounded-full bg-muted-foreground"
            style={{ width: `${Math.round((r.since / r.at) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
