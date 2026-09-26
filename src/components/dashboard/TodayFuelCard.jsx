// src/components/dashboard/TodayFuelCard.jsx
//
// Today's food and water at a glance (navigation redesign, phase 3).
// Nutrition stopped being a tab, so the Today screen is where you see how
// the day is going and the + is where you log it. Tapping the card opens
// Nutrition for the detail.
//
// Numbers only, no rings. The Nutrition page owns the rings and macros;
// this card answers one question, "how much is left today", and a second
// copy of those widgets is what made the old dashboard 26 sections long.
//
// The data comes from useTodayFuel, shared with the + sheet's water panel.

import { useNavigate } from 'react-router-dom';
import { Flame, Droplet, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useTodayFuel, summariseFuel } from '@/hooks/useTodayFuel';

// Re-exported for the existing glance tests.
export { summariseFuel };

function Line({ icon: Icon, label, value, goal, unit, fmt }) {
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {label}
        </span>
        <span className="text-sm tabular-nums">
          <span className="font-bold">{fmt(value)}</span>
          <span className="text-muted-foreground"> / {fmt(goal)} {unit}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
    </div>
  );
}

export default function TodayFuelCard({ userProfile = {} }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const navigate = useNavigate();
  const { visible, calories, waterOz, calorieGoal, waterGoal } = useTodayFuel(userProfile);

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => navigate('/nutrition')}
        className="w-full flex items-center gap-2 px-4 py-4 text-start transition-colors hover:bg-secondary active:bg-secondary"
        aria-label={tFallback('today.fuel.open', 'Open Nutrition')}
      >
        {/* Nothing logged yet: say so rather than drawing two empty bars
            at zero. A zero reads as a failure the user did not commit
            (see CLAUDE.md, "A section with no data must not render as
            zeros"), and plenty of people never track food. */}
        {visible.length === 0 ? (
          <div className="flex-1 min-w-0">
            <span className="block text-sm font-medium">{tFallback('today.fuel.title', 'Food and water')}</span>
            <span className="block text-label text-muted-foreground">
              {tFallback('today.fuel.empty', 'Nothing logged today. Tap + to add a meal or a glass of water.')}
            </span>
          </div>
        ) : (
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <Line icon={Flame} label={tFallback('today.fuel.calories', 'Calories')} fmt={fmt}
              value={calories} goal={calorieGoal} unit={tFallback('today.fuel.kcal', 'kcal')} />
            <Line icon={Droplet} label={tFallback('today.fuel.water', 'Water')} fmt={fmt}
              value={waterOz} goal={waterGoal} unit={tFallback('hydration.unit.oz', 'oz')} />
          </div>
        )}
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
      </button>
    </Card>
  );
}
