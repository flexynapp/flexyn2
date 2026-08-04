// src/pages/ComingSoon.jsx
//
// What a flagged-off route renders instead of its half-built surface.
//
// The alternative — a 404 — would be wrong twice: these features are coming,
// and someone who bookmarked the URL or followed an old link deserves an
// answer rather than a dead end. This mirrors the "Coming Soon" treatment
// already used for Trainer Programs inside Market.jsx, so a user who has
// seen one recognises the other.
//
// Deliberately not lazy-loaded: it is tiny, and it is the fallback for routes
// whose real chunk we are specifically choosing not to load.

import { useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ComingSoon({
  title = 'Coming soon',
  blurb = 'This one is still being built. It will show up here when it is ready.',
}) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
        <Lock className="w-6 h-6 text-primary/70" aria-hidden="true" />
      </div>

      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 mb-3 rounded-full bg-violet-500/15 border border-violet-400/25 text-[10px] font-bold uppercase tracking-wider text-violet-500">
        Coming soon
      </span>

      <h1 className="font-heading font-bold text-xl text-foreground">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">{blurb}</p>

      <Button
        variant="outline"
        className="mt-7 gap-2"
        onClick={() => navigate('/dashboard')}
      >
        <ArrowLeft className="w-4 h-4 rtl:scale-x-[-1]" aria-hidden="true" />
        Back to dashboard
      </Button>
    </div>
  );
}
