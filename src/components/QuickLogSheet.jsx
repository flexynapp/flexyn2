// src/components/QuickLogSheet.jsx
//
// The + in the middle of the tab bar (navigation redesign, phase 2).
// Logging is the thing people open a fitness app to do, and before this
// each kind of log lived on a different tab: meals on Nutrition, weight
// and photos on the Dashboard, a post on Hub. Nutrition stopped being a
// tab in this redesign on the understanding that meals are logged from
// here, so this sheet is what keeps that promise.
//
// Every row routes to a deep link the destination page already honours
// (the same ones the long-press tab menus used), so nothing here writes
// data itself. Phase 4 grows this into the full quick log with search.
//
// Navigation REPLACES the history entry the open sheet pushed (see
// useOverlayBackButton). Pushing would leave that entry behind, so Back
// from the destination would land on a sheet that is no longer there and
// need a second press.

import { useNavigate } from 'react-router-dom';
import { Dumbbell, Utensils, Droplet, Scale, Camera, PenSquare } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { useLanguage } from '@/lib/LanguageContext';
import { triggerHaptic } from '@/lib/haptic';

export const QUICK_LOG_ITEMS = [
  { id: 'workout', icon: Dumbbell,  to: '/workout?freestyle=1',     key: 'quickLog.workout', en: 'Workout' },
  { id: 'meal',    icon: Utensils,  to: '/nutrition?openLogMeal=1', key: 'quickLog.meal',    en: 'Meal' },
  { id: 'water',   icon: Droplet,   to: '/nutrition',               key: 'quickLog.water',   en: 'Water' },
  { id: 'weight',  icon: Scale,     to: '/dashboard?logWeight=1',   key: 'quickLog.weight',  en: 'Weight' },
  { id: 'photo',   icon: Camera,    to: '/dashboard?addPhoto=1',    key: 'quickLog.photo',   en: 'Progress photo' },
  { id: 'post',    icon: PenSquare, to: '/hub?compose=1',           key: 'quickLog.post',    en: 'Post' },
];

export default function QuickLogSheet({ open, onClose }) {
  const navigate = useNavigate();
  const { tFallback } = useLanguage();

  const go = (to) => {
    triggerHaptic('light');
    navigate(to, { replace: true });
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={tFallback('quickLog.title', 'Log something')}>
      <div className="grid grid-cols-3 gap-2 px-4 pb-4">
        {QUICK_LOG_ITEMS.map(({ id, icon: Icon, to, key, en }) => (
          <button
            key={id}
            type="button"
            onClick={() => go(to)}
            className="min-h-20 flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm font-medium transition-colors hover:bg-secondary active:bg-secondary"
          >
            <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
            <span>{tFallback(key, en)}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
