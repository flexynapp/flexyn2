import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent } from '@testing-library/react';
import { Input } from '@/components/ui/input';
import { openNativePicker } from '@/lib/nativePicker';

function withShowPicker(el) {
  el.showPicker = vi.fn();
  return el.showPicker;
}

describe('date fields open their picker on a tap anywhere', () => {
  it('Input type=date calls showPicker on click', () => {
    const { container } = render(<Input type="date" onChange={() => {}} />);
    const input = container.querySelector('input');
    const spy = withShowPicker(input);
    fireEvent.click(input);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps a caller onClick and still opens the picker', () => {
    const onClick = vi.fn();
    const { container } = render(<Input type="datetime-local" onClick={onClick} />);
    const input = container.querySelector('input');
    const spy = withShowPicker(input);
    fireEvent.click(input);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('leaves text inputs alone', () => {
    const { container } = render(<Input type="text" />);
    const input = container.querySelector('input');
    const spy = withShowPicker(input);
    fireEvent.click(input);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips disabled fields and swallows a showPicker throw', () => {
    const disabled = Object.assign(document.createElement('input'), { type: 'date', disabled: true });
    const spy = withShowPicker(disabled);
    openNativePicker(disabled);
    expect(spy).not.toHaveBeenCalled();

    const throwing = Object.assign(document.createElement('input'), { type: 'date' });
    throwing.showPicker = () => { throw new DOMException('no activation', 'NotAllowedError'); };
    expect(() => openNativePicker(throwing)).not.toThrow();
  });

  it('works where showPicker does not exist (older iOS)', () => {
    const el = Object.assign(document.createElement('input'), { type: 'date' });
    expect(() => openNativePicker(el)).not.toThrow();
  });

  // A raw <input type="date"> skips the Input component, so it has to wire
  // the handler itself. This fails when a new one forgets.
  it('every raw date or time <input> in src wires openPickerOnClick', () => {
    const root = join(process.cwd(), 'src');
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__' && name !== 'i18n-langs') walk(p);
        } else if (p.endsWith('.jsx')) files.push(p);
      }
    };
    walk(root);
    const offenders = [];
    const re = /<input\b(.*?)\/>/gs;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(re)) {
        if (/type=["'](date|datetime-local|time|month|week)["']/.test(m[1]) && !m[1].includes('openPickerOnClick')) {
          offenders.push(f.replace(root, 'src'));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
