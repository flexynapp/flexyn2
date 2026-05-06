import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function SetRow({ set, index, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-6 text-center font-medium">{index + 1}</span>
      <div className="flex-1">
        <Input
          type="number"
          min="0"
          step="0.5"
          value={set.weight || ''}
          onChange={e => onChange({ ...set, weight: parseFloat(e.target.value) || 0 })}
          placeholder="lbs"
          className="h-9 text-center"
        />
      </div>
      <span className="text-muted-foreground text-xs">×</span>
      <div className="flex-1">
        <Input
          type="number"
          min="0"
          value={set.reps || ''}
          onChange={e => onChange({ ...set, reps: parseInt(e.target.value) || 0 })}
          placeholder="reps"
          className="h-9 text-center"
        />
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove}>
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>
    </div>
  );
}