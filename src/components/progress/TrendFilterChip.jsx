import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';

/**
 * TrendFilterChip — one filter dimension, showing its own current value.
 *
 * This replaces the Trends tab's "Filter (2)" dropdown, and the reason is
 * the badge. To learn what the tab was showing you you had to tap Filter,
 * then tap open one of three sub-accordions, per dimension; the trigger's
 * only summary was a count. A filter whose state can be read only by
 * operating it is not a filter, it is a quiz.
 *
 * So the chip's label IS the selection. The count badge is gone because
 * there is nothing left for it to stand in for.
 *
 * The panel is a `BottomSheet` rather than a hand-rolled popover. The old
 * one positioned itself `fixed` off a `getBoundingClientRect`, re-measured
 * on scroll and resize, and had no `aria-expanded`, no `role`, no Escape
 * handler, no focus trap and no focus restore — and it dismissed on
 * `mousedown` only. BottomSheet already solves all of that, and it is the
 * idiom the rest of this phone-only app uses.
 */
export default function TrendFilterChip({ label, value, items, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.value === value);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1 min-h-[44px] ps-3 pe-2 rounded-full border border-border text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors max-w-full"
      >
        <span className="truncate">{selected?.label ?? label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="pb-2">
          {items.map((item) => {
            const isSelected = item.value === value;
            return (
              <button
                key={item.value}
                onClick={() => { onChange(item.value); setOpen(false); }}
                aria-current={isSelected ? 'true' : undefined}
                // 48px floor — the Apple HIG minimum, and a floor is not
                // a gap, so it does not move with the spacing scale.
                className={`w-full flex items-center justify-between gap-2 min-h-[48px] px-4 text-start text-sm transition-colors border-t border-border/60 first:border-t-0 ${
                  isSelected
                    ? 'text-primary font-semibold'
                    : 'hover:bg-secondary/50 active:bg-secondary/50'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {isSelected && <Check className="w-4 h-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
