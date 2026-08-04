import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

function SubAccordion({ label, value, items, onChange, open, onToggle }) {
  const selectedLabel = items.find(i => i.value === value)?.label;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-secondary/50 active:bg-secondary/50 transition-colors"
      >
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          <span className="text-sm font-semibold">{selectedLabel}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-secondary/10 max-h-48 overflow-y-auto">
          {items.map(item => (
            <button
              key={item.value}
              onClick={() => { onChange(item.value); onToggle(); }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                item.value === value
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-secondary/50 active:bg-secondary/50'
              }`}
            >
              {item.label}
              {item.value === value && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilterDropdown({
  selectedRegimen, onRegimenChange, regimenItems,
  selectedTimeRange, onTimeRangeChange, timeRangeItems,
  selectedMuscleGroup, onMuscleGroupChange, muscleGroupItems,
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState(null); // 'regimen' | 'timeRange' | 'muscleGroup' | null
  const [dropdownPos, setDropdownPos] = useState({});
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  const activeCount = [
    selectedRegimen !== 'all' ? 1 : 0,
    selectedTimeRange !== '90' ? 1 : 0,
    selectedMuscleGroup !== 'all' ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const toggleSub = (key) => setOpenSub(prev => (prev === key ? null : key));

  const calcPos = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = Math.min(288, window.innerWidth - 32);
    let left = rect.right - dropdownWidth;
    if (left < 16) left = 16;
    if (left + dropdownWidth > window.innerWidth - 16) left = window.innerWidth - 16 - dropdownWidth;
    setDropdownPos({ top: rect.bottom + 8, left, width: dropdownWidth });
  };

  useEffect(() => {
    if (!open) return;
    calcPos();
    window.addEventListener('scroll', calcPos, true);
    window.addEventListener('resize', calcPos);
    return () => {
      window.removeEventListener('scroll', calcPos, true);
      window.removeEventListener('resize', calcPos);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
      setOpenSub(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => { setOpen(o => !o); if (open) setOpenSub(null); }}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-secondary active:bg-secondary transition-colors"
      >
        <span className="text-sm font-medium">{t('progress.filter')}</span>
        {activeCount > 0 && (
          <span className="flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-primary rounded-full">
            {activeCount}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className="fixed bg-card border border-border rounded-lg shadow-lg p-3 space-y-2 z-[200] overflow-y-auto"
          style={{ ...dropdownPos, maxHeight: dropdownPos.top ? `calc(100vh - ${dropdownPos.top + 16}px)` : undefined }}
        >
          <SubAccordion
            label={t('progress.filterRegimenLabel')}
            value={selectedRegimen}
            items={regimenItems}
            onChange={onRegimenChange}
            open={openSub === 'regimen'}
            onToggle={() => toggleSub('regimen')}
          />
          <SubAccordion
            label={t('progress.timeRange')}
            value={selectedTimeRange}
            items={timeRangeItems}
            onChange={onTimeRangeChange}
            open={openSub === 'timeRange'}
            onToggle={() => toggleSub('timeRange')}
          />
          <SubAccordion
            label={t('widgets.muscleGroups')}
            value={selectedMuscleGroup}
            items={muscleGroupItems}
            onChange={onMuscleGroupChange}
            open={openSub === 'muscleGroup'}
            onToggle={() => toggleSub('muscleGroup')}
          />
        </div>
      )}
    </div>
  );
}
