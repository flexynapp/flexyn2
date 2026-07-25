// src/lib/logoTapEgg.js
//
// Hidden easter egg: tapping the header logo 7× in quick succession sets
// off a deliberately RIDICULOUS confetti barrage + a random cheeky-but-
// nice toast. Pure (no React) so it can be fired from anywhere; the tap
// detection lives at the call site.

import { toast } from '@/lib/toast';

// Rotated at random on every trigger — cheeky, but kind.
const MESSAGES = [
  'You found nothing. Keep lifting. 💪',
  'Certified button masher. Go touch a barbell.',
  "That's not a workout. But respect the dedication. 🏋️",
  'You unlocked… absolutely nothing. Looks great on you though.',
  'Easter egg achieved. Reward: this confetti and our admiration.',
  'Whoa whoa whoa. Save that energy for your last set.',
  'Secret found! …it was friendship the whole time. (And confetti.)',
  '7 taps. 0 gains. Infinite style.',
];

const COLORS = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#06b6d4', '#fde047', '#ffffff'];

export function fireLogoTapEgg() {
  // Toast + haptic always fire (even under reduced-motion).
  const msg = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  toast.success(msg, { duration: 5000 });
  try { navigator.vibrate?.([20, 40, 20, 40, 20, 40, 120]); } catch { /* ignore */ }

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  import('canvas-confetti')
    .then(({ default: confetti }) => {
      // 1) Opening mega-burst from the top-center.
      confetti({ particleCount: 400, spread: 170, startVelocity: 55, origin: { x: 0.5, y: 0.35 }, colors: COLORS, ticks: 260, scalar: 1.15 });

      // 2) Sustained dual side-cannons for ~1.8s — the "absurd" part.
      const end = Date.now() + 1800;
      (function frame() {
        confetti({ particleCount: 12, angle: 60, spread: 75, startVelocity: 62, origin: { x: 0, y: 1 }, colors: COLORS });
        confetti({ particleCount: 12, angle: 120, spread: 75, startVelocity: 62, origin: { x: 1, y: 1 }, colors: COLORS });
        if (Date.now() < end) requestAnimationFrame(frame);
      }());

      // 3) Random fat pops raining from the top.
      let pops = 0;
      const timer = setInterval(() => {
        confetti({ particleCount: 100, spread: 110, startVelocity: 45, origin: { x: Math.random(), y: Math.random() * 0.35 }, colors: COLORS, scalar: 1.1 });
        pops += 1;
        if (pops >= 8) clearInterval(timer);
      }, 200);
    })
    .catch(() => { /* decorative — skip on load failure */ });
}
