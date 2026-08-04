import React, { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Check } from 'lucide-react';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

/**
 * Drop-in replacement for shadcn Select that renders a bottom Drawer on mobile.
 * Props mirror shadcn Select: value, onValueChange, placeholder, className, triggerClassName, children (SelectItem list).
 * Items should be passed as an array: items={[{ value, label }]}
 */
export default function MobileSelect({ value, onValueChange, placeholder, triggerClassName, items = [], disabled }) {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selectedLabel = items.find(i => i.value === value)?.label;

  if (!isMobile) {
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setDrawerOpen(true)}
        className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 select-none-ui ${triggerClassName || ''}`}
      >
        <span className={selectedLabel ? 'text-foreground' : 'text-muted-foreground'}>
          {selectedLabel || placeholder || 'Select...'}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 shrink-0"><path d="m6 9 6 6 6-6"/></svg>
      </button>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="font-heading">{placeholder || 'Select an option'}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-1 overflow-y-auto max-h-[60vh]">
            {items.map(item => (
              <button
                key={item.value}
                type="button"
                onClick={() => { onValueChange(item.value); setDrawerOpen(false); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors select-none-ui"
              >
                <span>{item.label}</span>
                {value === item.value && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}