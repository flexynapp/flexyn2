// src/components/hub/ContentWarningGate.jsx
//
// Wraps a post's body + media in a blurred overlay until the viewer
// explicitly opts in. Pattern from Twitter / Mastodon / Reddit's NSFW
// blur — the poster declared this content sensitive, the viewer makes
// the conscious choice to see it.
//
// USAGE
//
//   <ContentWarningGate warning="graphic_injury">
//     <img loading="lazy" src={post.image_url} />
//     <p>{post.content}</p>
//   </ContentWarningGate>
//
// PROPS
//
//   warning       One of CW_LABELS keys, OR a freeform label string
//                 (used when the type is 'other').
//   customLabel   Optional freeform string used as the visible label
//                 when warning is 'other'.
//   children      The content to gate.
//
// BEHAVIOR
//
//   • Locked by default each session — no persistence. The CW should
//     re-arm on app reload; clearing it across remounts is a future
//     "trust this user's CW posts" pref.
//   • Tap-to-reveal swaps the blur for the children. Once unlocked,
//     stays unlocked for this card instance.

import { useState } from 'react';
import { EyeOff, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

const CW_LABELS = {
  graphic_injury: 'Graphic injury',
  sensitive:      'Sensitive content',
  spoiler:        'Spoiler',
  other:          'Content warning',
};

export default function ContentWarningGate({ warning, customLabel, children }) {
  const { tFallback } = useLanguage();
  const [revealed, setRevealed] = useState(false);

  if (!warning) return <>{children}</>;
  if (revealed) return <>{children}</>;

  const label = warning === 'other' && customLabel
    ? customLabel
    : (CW_LABELS[warning] || CW_LABELS.other);

  return (
    <div className="relative rounded-xl overflow-hidden">
      {/* Background — the gated content rendered behind the blur so the
          gate dimensions match the underlying card. pointer-events-none
          so taps go through to the reveal button. */}
      <div
        className="pointer-events-none select-none"
        style={{ filter: 'blur(28px)', transform: 'scale(1.05)' }}
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Foreground reveal CTA */}
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm text-foreground hover:bg-background/80 active:bg-background/80 transition-colors"
      >
        <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <p className="kicker text-primary">
          {label}
        </p>
        <p className="text-sm font-medium flex items-center gap-1.5">
          <EyeOff className="w-3.5 h-3.5" />
          {tFallback("contentWarningGate.tapToReveal", "Tap to reveal")}
        </p>
      </button>
    </div>
  );
}
