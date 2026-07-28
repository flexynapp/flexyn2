// Tier system based on level (every 10 levels: new tier with unique color + animation effect)
export function getTier(level, t) {
  if (level >= 91) return {
    name: t('levelBar.tier.legendary'),
    id: 'legendary',
    surface: 'radial-gradient(110% 74% at 14% 2%, rgba(255,240,170,0.72), rgba(255,240,170,0) 54%), radial-gradient(85% 65% at 62% 22%, rgba(249,115,22,0.55), rgba(249,115,22,0) 60%), radial-gradient(95% 80% at 96% 62%, rgba(190,24,93,0.50), rgba(190,24,93,0) 64%), linear-gradient(162deg, #fde047 0%, #ea6a17 40%, #7a1338 100%)',
    badge: 'from-yellow-400 via-orange-400 to-red-500',
    bar: 'from-yellow-400 via-orange-400 to-red-500',
    bg: 'bg-yellow-500/10 border border-yellow-500/30',
    text: 'text-yellow-500',
    glow: 'shadow-yellow-500/40',
    particles: 'golden',
  };
  if (level >= 81) return {
    name: t('levelBar.tier.diamond'),
    id: 'diamond',
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(207,250,254,0.65), rgba(207,250,254,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(79,70,229,0.52), rgba(79,70,229,0) 62%), linear-gradient(162deg, #67e8f9 0%, #3b6fe0 44%, #241a72 100%)',
    badge: 'from-cyan-300 via-blue-400 to-indigo-500',
    bar: 'from-cyan-300 to-indigo-500',
    bg: 'bg-cyan-500/10 border border-cyan-400/30',
    text: 'text-cyan-400',
    glow: 'shadow-cyan-400/40',
    particles: 'sparkle',
  };
  if (level >= 71) return {
    name: t('levelBar.tier.platinum'),
    id: 'platinum',
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(255,255,255,0.62), rgba(255,255,255,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(100,116,139,0.45), rgba(100,116,139,0) 62%), linear-gradient(162deg, #e2e8f0 0%, #8494ab 45%, #3d4a66 100%)',
    badge: 'from-slate-300 via-slate-400 to-slate-500',
    bar: 'from-slate-300 to-slate-500',
    bg: 'bg-slate-400/10 border border-slate-400/30',
    text: 'text-slate-300',
    glow: 'shadow-slate-400/30',
    particles: 'pulse',
  };
  if (level >= 61) return {
    name: t('levelBar.tier.amethyst'),
    id: 'amethyst',
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(233,213,255,0.58), rgba(233,213,255,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(147,51,234,0.50), rgba(147,51,234,0) 62%), linear-gradient(162deg, #c084fc 0%, #8226d9 45%, #3b0d63 100%)',
    badge: 'from-purple-400 via-violet-500 to-fuchsia-500',
    bar: 'from-purple-400 to-fuchsia-500',
    bg: 'bg-purple-500/10 border border-purple-500/30',
    text: 'text-purple-400',
    glow: 'shadow-purple-500/40',
    particles: 'sparkle',
  };
  if (level >= 51) return {
    name: t('levelBar.tier.ruby'),
    id: 'ruby',
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(255,205,215,0.55), rgba(255,205,215,0) 56%), radial-gradient(95% 72% at 86% 24%, rgba(190,18,60,0.55), rgba(190,18,60,0) 62%), linear-gradient(162deg, #fb7185 0%, #c81e51 44%, #560d28 100%)',
    badge: 'from-red-400 via-rose-500 to-pink-500',
    bar: 'from-red-400 to-pink-500',
    bg: 'bg-rose-500/10 border border-rose-500/30',
    text: 'text-rose-400',
    glow: 'shadow-rose-500/40',
    particles: 'pulse',
  };
  if (level >= 41) return {
    name: t('levelBar.tier.emerald'),
    id: 'emerald',
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(187,247,208,0.58), rgba(187,247,208,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(13,148,136,0.50), rgba(13,148,136,0) 62%), linear-gradient(162deg, #34d399 0%, #0e8a6b 45%, #06342f 100%)',
    badge: 'from-emerald-400 via-green-500 to-teal-500',
    bar: 'from-emerald-400 to-teal-500',
    bg: 'bg-emerald-500/10 border border-emerald-500/30',
    text: 'text-emerald-400',
    glow: 'shadow-emerald-500/40',
    particles: 'sparkle',
  };
  if (level >= 31) return {
    name: t('levelBar.tier.sapphire'),
    id: 'sapphire',
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(186,230,253,0.58), rgba(186,230,253,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(37,99,235,0.50), rgba(37,99,235,0) 62%), linear-gradient(162deg, #38bdf8 0%, #2255c4 45%, #16205e 100%)',
    badge: 'from-blue-400 via-blue-500 to-indigo-500',
    bar: 'from-blue-400 to-indigo-500',
    bg: 'bg-blue-500/10 border border-blue-500/30',
    text: 'text-blue-400',
    glow: 'shadow-blue-500/40',
    particles: 'pulse',
  };
  if (level >= 21) return {
    name: t('levelBar.tier.gold'),
    id: 'gold',
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(255,241,178,0.65), rgba(255,241,178,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(217,119,6,0.48), rgba(217,119,6,0) 62%), linear-gradient(162deg, #fbbf24 0%, #c2760a 45%, #6b3d09 100%)',
    badge: 'from-amber-400 via-yellow-500 to-orange-400',
    bar: 'from-amber-400 to-orange-400',
    bg: 'bg-amber-500/10 border border-amber-400/30',
    text: 'text-amber-400',
    glow: 'shadow-amber-400/30',
    particles: 'sparkle',
  };
  if (level >= 11) return {
    name: t('levelBar.tier.silver'),
    id: 'silver',
    wear: 0.45,
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(255,255,255,0.55), rgba(255,255,255,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(148,163,184,0.50), rgba(148,163,184,0) 62%), linear-gradient(162deg, #cbd5e1 0%, #74839a 45%, #33415c 100%)',
    badge: 'from-slate-300 to-slate-400',
    bar: 'from-slate-300 to-slate-400',
    bg: 'bg-slate-300/10 border border-slate-300/20',
    text: 'text-slate-400',
    glow: 'shadow-slate-300/20',
    particles: 'none',
  };
  return {
    name: t('levelBar.tier.bronze'),
    id: 'bronze',
    // The gradient is the original — bright amber highlight, red bloom,
    // deep umber base. What makes Bronze read as the bottom rung isn't a
    // duller colour (a browner Bronze just looked muddy); it's `wear`
    // below, which pits the surface with rust patches. Worn, not faded.
    surface: 'radial-gradient(115% 78% at 16% 4%, rgba(255,214,140,0.62), rgba(255,214,140,0) 56%), radial-gradient(95% 72% at 88% 26%, rgba(220,38,38,0.42), rgba(220,38,38,0) 62%), linear-gradient(162deg, #f59e0b 0%, #d1490b 44%, #6b2410 100%)',
    // 0 = pristine, 1 = heavily pitted. Only the bottom of the ladder is
    // corroded; the metal gets cleaner as you climb, which does the
    // "you are early" work without dimming anything.
    wear: 1,
    badge: 'from-orange-500 to-amber-600',
    bar: 'from-primary to-accent',
    bg: 'bg-primary/10 border border-primary/20',
    text: 'text-primary',
    glow: 'shadow-primary/20',
    particles: 'none',
  };
}