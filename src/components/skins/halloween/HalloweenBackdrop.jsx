// src/components/skins/halloween/HalloweenBackdrop.jsx
//
// The Halloween skin's `Backdrop`: a night scene fixed BEHIND the page.
// Stars, a harvest moon, corner cobwebs with a spider, a witch and her bats
// crossing now and then, and a graveyard along the bottom with a scarecrow
// and two jack o lanterns.
//
// Everything lives here, behind the page, on purpose. Cards are opaque, so
// the scene shows only in the gaps between them, under short pages and in
// the desktop gutters, and it can never cover content. The earlier cut put
// the webs and the witch in an overlay above the page; they crossed text
// and buttons, which is the failure the old themes had.
//
// Text does sit on the bare background between cards, so every figure is
// drawn at the ink strength the skin declares (`ink` in src/lib/skins.js)
// and no stronger. skinContrast.test.js proves text still clears 4.5:1
// over that ink in light and dark. Each figure is ONE layer at that
// strength: group opacity on a <g> composites once, so overlapping shapes
// inside a group don't darken each other, and figures are placed so they
// don't overlap one another on a phone.
//
// -z-10 puts it under non-positioned page content in the root stacking
// context. That only works because Layout's shell is transparent while a
// skin is on (the `.app-shell` rule in index.css).

import { useId } from 'react';
import { SKINS } from '@/lib/skins';
import { Cobweb, Spider, Witch, Bat } from './ornaments';
import { GROUND_PATH, SKY_PATH, PLANTED, RAILS } from './graveyard';

const STANDING = PLANTED.filter((f) => !f.lantern);
const LANTERNS = PLANTED.filter((f) => f.lantern);

const { ink } = SKINS.find((s) => s.id === 'halloween');
const FG = ink.foreground;
const MOON = ink.primary;
const GLOW = ink.glow;
// A jack o lantern's body sits below the moon's strength so its lit face,
// at the glow ink, reads as the brightest thing on the hill.
const EMBER = Math.round(ink.primary * 0.65 * 100) / 100;

// Deterministic star field, in viewBox units of a 100x60 sky.
const STARS = [
  [8, 6], [19, 14], [27, 4], [36, 19], [44, 9], [55, 16], [63, 5], [71, 22],
  [12, 27], [30, 31], [48, 26], [58, 35], [83, 30], [92, 12], [4, 40], [76, 41],
];

export default function HalloweenBackdrop() {
  const sky = `hw-sky-${useId().replace(/:/g, '')}`;
  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden text-foreground"
      aria-hidden="true"
      data-testid="halloween-backdrop"
    >
      <svg className="absolute inset-x-0 top-0 w-full h-[60vh] hw-twinkle" viewBox="0 0 100 60" preserveAspectRatio="xMidYMin slice">
        <g fill="currentColor" style={{ opacity: FG }}>
          {STARS.map(([x, y], i) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={i % 3 === 0 ? 0.45 : 0.3} />
          ))}
        </g>
      </svg>

      {/* Below the header on phones, at the window top on desktop. */}
      <div className="absolute inset-x-0 top-[calc(56px+env(safe-area-inset-top))] lg:top-0">
        <div style={{ opacity: FG }}>
          <Cobweb className="absolute top-0 start-0 rtl:scale-x-[-1]" />
          <Cobweb className="absolute top-0 end-0 scale-x-[-1] rtl:scale-x-100" />
          <div className="absolute top-0 end-9 flex flex-col items-center hw-dangle">
            <span className="block w-px h-14 bg-current" />
            <Spider />
          </div>
        </div>

        {/* The flyover: one timeline for the witch and her bats, so they
            cross together and the sky is quiet the rest of the cycle.
            Physical left-0, not start-0: the whole lane is mirrored in RTL
            (.hw-motion in halloween.css), and a logical inset flipped a
            second time started the witch 110px on screen, flying off the
            wrong edge. */}
        <div className="hw-motion absolute inset-x-0 top-24 h-24" style={{ opacity: FG }}>
          <div className="hw-fly absolute left-0 top-0">
            <div className="hw-bob"><Witch /></div>
          </div>
          <Bat className="hw-fly hw-fly-b absolute left-0 top-10" />
          <Bat className="hw-fly hw-fly-c absolute left-0 top-1" />
          <Bat className="hw-fly hw-fly-d absolute left-0 top-16" />
        </div>
      </div>

      {/* Crescent moon in --primary at the declared strength. It was a full
          disc, and at this strength a plain disc read as a stray brown blob
          rather than a moon; the crescent is the silhouette nobody has to
          decode. One path, one layer. Kept clear of the flyover's lane. */}
      <svg className="absolute top-[42%] end-[8%] w-16 h-16 rtl:scale-x-[-1]" viewBox="0 0 100 100" data-testid="halloween-moon">
        <path d="M62 6A46 46 0 1 0 62 94A38 44 0 1 1 62 6Z" fill="hsl(var(--primary))" opacity={MOON} />
      </svg>

      {/* Graveyard, cropped at the sides on wide screens rather than scaled
          up. Its foot meets the nav's top, so the ground runs behind the
          pumpkin row and the patch grows out of it. --nav-h already
          includes --skin-nav-edge; adding it again floated the whole
          graveyard up into the page's last lines. Every figure is planted
          from the ground curve in graveyard.js, never hand-placed. */}
      <svg
        className="absolute inset-x-0 bottom-[calc(var(--nav-h)-var(--skin-nav-edge,0px))] lg:bottom-0 w-full h-[clamp(96px,32vw,150px)]"
        viewBox="0 0 400 160"
        preserveAspectRatio="xMidYMax slice"
      >
        <g fill="currentColor" stroke="currentColor" strokeLinecap="round" style={{ opacity: FG }}>
          <path strokeWidth="0" d={GROUND_PATH} />
          {STANDING.map((f) => (
            <path key={`${f.kind}-${f.x0}`} strokeWidth="0" d={f.d} transform={f.transform} />
          ))}
          {STANDING.flatMap((f) => (f.parts || []).map((d) => <path key={d} strokeWidth="0" d={d} />))}
          {STANDING.filter((f) => f.head).map((f) => (
            <path key={`head-${f.x0}`} strokeWidth="0" fillRule="evenodd" d={f.head} />
          ))}
          {/* Eyelids: they close downward over each eye hole in the same ink
              as the head, while the lit eye below shrinks by the same
              amount, so the hole is always exactly covered once. */}
          {STANDING.flatMap((f) => (f.eyes || []).map((e) => (
            <rect key={`lid-${e.x}`} className="hw-lid" strokeWidth="0" x={e.x} y={e.y} width={e.w} height={e.h} />
          )))}
          {RAILS.map((r) => <path key={`rail-${r.d}`} strokeWidth="0" d={r.d} />)}
          {PLANTED.filter((f) => f.branches).map((f) => (
            <path key={`branches-${f.x0}`} fill="none" strokeWidth="3" d={f.branches} />
          ))}
        </g>
        {/* Jack o lanterns in the brand orange, dimmer than the moon, with
            their faces cut through and filled with the glow ink, so each
            face is lit from inside. Clipped to the sky so the part buried in
            the hill is hidden instead of stacking on the ground's ink, which
            would paint stronger than the skin declares. */}
        <defs>
          <clipPath id={sky}><path d={SKY_PATH} /></clipPath>
        </defs>
        <g clipPath={`url(#${sky})`} fill="hsl(var(--primary))" style={{ opacity: EMBER }} data-testid="halloween-lanterns">
          {LANTERNS.map((f) => (
            <g key={`${f.kind}-${f.x0}`}>
              <path fillRule="evenodd" d={f.d} />
              <path d={f.stem} />
            </g>
          ))}
        </g>
        {/* Everything lit: the lantern faces flicker, the scarecrow's eyes
            blink. A flicker only ever dims below the glow ink. */}
        <g clipPath={`url(#${sky})`} fill="hsl(var(--primary))" style={{ opacity: GLOW }} data-testid="halloween-glow">
          {LANTERNS.map((f, i) => (
            <path key={`face-${f.x0}`} className={`hw-flicker${i % 2 ? ' hw-flicker-b' : ''}`} d={f.face} />
          ))}
          {STANDING.flatMap((f) => (f.eyes || []).map((e) => (
            <rect key={`eye-${e.x}`} className="hw-eye" x={e.x} y={e.y} width={e.w} height={e.h} />
          )))}
        </g>
      </svg>
    </div>
  );
}
