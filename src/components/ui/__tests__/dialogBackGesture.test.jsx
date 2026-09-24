// Every dialog and sheet closes on the phone's Back gesture (navigation
// redesign, phase 0). Before, only two overlays did, and Back on any other
// dialog left the page underneath it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from '@/components/ui/alert-dialog';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, tFallback: (_k, en) => en, language: 'en' }),
}));

const back = () => act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });

describe('dialogs close on the Back gesture', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('closes an uncontrolled Dialog opened from its trigger', async () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent><DialogTitle>Hello</DialogTitle></DialogContent>
      </Dialog>,
    );
    act(() => { screen.getByText('Open').click(); });
    expect(screen.getByText('Hello')).toBeTruthy();
    back();
    expect(screen.queryByText('Hello')).toBeNull();
  });

  it('asks a controlled Dialog to close through onOpenChange(false)', () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent><DialogTitle>Hi</DialogTitle></DialogContent>
      </Dialog>,
    );
    back();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes an AlertDialog', () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Delete?</AlertDialogTitle>
            <AlertDialogDescription>Gone for good.</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    render(<Harness />);
    expect(screen.getByText('Delete?')).toBeTruthy();
    back();
    expect(screen.queryByText('Delete?')).toBeNull();
  });

  it('only the top dialog closes when two are stacked', () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onOpenChange={outer}><DialogContent><DialogTitle>Outer</DialogTitle></DialogContent></Dialog>
        <Dialog open onOpenChange={inner}><DialogContent><DialogTitle>Inner</DialogTitle></DialogContent></Dialog>
      </>,
    );
    back();
    expect(inner).toHaveBeenCalledWith(false);
    expect(outer).not.toHaveBeenCalled();
  });
});
