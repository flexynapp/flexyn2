// src/components/workout/TrainHeroSlide.jsx
//
// One slide of the Train tab's hero carousel (Freestyle, Gauntlet, Crew
// Wars). Each slide used to paint its own night sky: a hand-mixed dark
// gradient, two blurred radial glows, an animated shimmer sweep, a
// coloured drop shadow and a glossy highlight on the icon. The Gauntlet's
// was purple, which the app keeps for rarity alone (kegan, 2026-09-24).
// Those are the tells the UI rules in CLAUDE.md name as generated rather
// than designed, and they were the first thing the Train tab showed.
//
// Now one solid card surface with a hairline, and the slide's identity
// carried by a single tone on its icon tile and kicker. Weight and size
// still make it the page's dominant element; colour no longer has to.

const TONES = {
  primary: { tile: 'bg-primary text-primary-foreground', kicker: 'text-primary', pill: 'bg-primary/10 text-primary' },
  soft:    { tile: 'bg-primary/15 text-primary',         kicker: 'text-primary', pill: 'bg-primary/10 text-primary' },
  success: { tile: 'bg-success/15 text-success',         kicker: 'text-success', pill: 'bg-success/10 text-success' },
};

export default function TrainHeroSlide({ onClick, tone = 'primary', kicker, title, blurb, pill, pulse = false, icon: Icon }) {
  const t = TONES[tone] || TONES.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-full rounded-2xl border border-border bg-card text-foreground text-start transition-colors hover:bg-secondary active:bg-secondary"
    >
      <div className="flex items-center justify-between gap-6 p-6 md:p-8">
        <div className="min-w-0">
          <span className={`block text-micro font-bold tracking-[0.25em] uppercase mb-2 ${t.kicker}`}>{kicker}</span>
          <span className="font-heading font-black text-3xl md:text-4xl leading-none block tracking-tight min-h-[2em]">{title}</span>
          <span className="text-label text-muted-foreground mt-2 block max-w-[36ch] leading-relaxed min-h-[3.25em]">{blurb}</span>
          {pill && (
            <span className={`inline-flex items-center gap-1 mt-2 px-2 py-1 rounded-full text-micro font-semibold tracking-wide uppercase ${t.pill}`}>
              {pulse && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden="true" />}
              {pill}
            </span>
          )}
        </div>
        <div className={`shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center ${t.tile}`} aria-hidden="true">
          <Icon className="w-7 h-7" />
        </div>
      </div>
    </button>
  );
}
