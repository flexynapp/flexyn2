// src/pages/RankUpPreview.jsx
//
// A test bench for the rank up sequence, so it can be watched on a real
// phone at the phone's own frame rate rather than in a screen recording.
// A promotion only plays after the server moves someone, which nobody can
// trigger on demand, so without this the only way to see it was a video.
//
// Only reachable on a Netlify deploy preview or localhost (see App.jsx);
// production never routes here. It renders the real component with sample
// moves and writes nothing.

import { useState } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { getTier, leagueTierName } from '@/lib/leagueTiers';
import RankUpSequence from '@/components/leagues/RankUpSequence';
import { Button } from '@/components/ui/button';

const MOVES = [
  { move: { kind: 'tier', from: { tier: 'silver', level: 4 }, to: { tier: 'gold', level: 1 } }, strength: { score: 262, next_tier: 'platinum', next_floor: 325 } },
  { move: { kind: 'tier', from: { tier: 'diamond', level: 2 }, to: { tier: 'legend', level: 1 } }, strength: { score: 480 } },
  { move: { kind: 'placed', from: null, to: { tier: 'gold', level: 1 } }, strength: { score: 262, next_tier: 'platinum', next_floor: 325 } },
  { move: { kind: 'level', from: { tier: 'gold', level: 2 }, to: { tier: 'gold', level: 3 } }, strength: { score: 280, next_tier: 'platinum', next_floor: 325 } },
  { move: { kind: 'down', from: { tier: 'gold', level: 3 }, to: { tier: 'silver', level: 1 } }, strength: { score: 220, next_tier: 'gold', next_floor: 250 } },
];

// Buttons are labelled with the sequence's own words, so this page adds no
// copy of its own.
const KIND_LABEL = {
  tier: ['rankUp.promoted', 'Promoted'],
  placed: ['rankUp.placed', 'Your league'],
  level: ['rankUp.newLevel', 'New level'],
  down: ['rankUp.demoted', 'Moved down'],
};

export default function RankUpPreview() {
  const { tFallback } = useLanguage();
  const [play, setPlay] = useState(null);
  const [run, setRun] = useState(0);
  return (
    <div className="dark min-h-screen bg-background text-foreground px-4 py-6 flex flex-col gap-2">
      {MOVES.map((m, i) => (
        <Button key={i} variant="secondary" className="h-12 justify-between" onClick={() => { setRun((r) => r + 1); setPlay(i); }}>
          <span>{tFallback(...KIND_LABEL[m.move.kind])}</span>
          <span className="text-muted-foreground">{leagueTierName(getTier(m.move.to.tier), tFallback, m.move.to.level)}</span>
        </Button>
      ))}
      {play != null && (
        <RankUpSequence
          key={run}
          move={MOVES[play].move}
          strength={MOVES[play].strength}
          onClose={() => setPlay(null)}
          onViewLeague={() => {}}
        />
      )}
    </div>
  );
}
