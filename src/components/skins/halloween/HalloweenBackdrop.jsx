// src/components/skins/halloween/HalloweenBackdrop.jsx
//
// The Halloween skin's `Backdrop`: a night scene fixed BEHIND the page.
// Stars, a harvest moon, corner cobwebs with a spider, a witch and her bats
// crossing now and then, and a graveyard along the bottom.
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

import { SKINS } from '@/lib/skins';
import { Cobweb, Spider, Witch, Bat } from './ornaments';

const { ink } = SKINS.find((s) => s.id === 'halloween');
const FG = ink.foreground;
const MOON = ink.primary;

// Deterministic star field, in viewBox units of a 100x60 sky.
const STARS = [
  [8, 6], [19, 14], [27, 4], [36, 19], [44, 9], [55, 16], [63, 5], [71, 22],
  [12, 27], [30, 31], [48, 26], [58, 35], [83, 30], [92, 12], [4, 40], [76, 41],
];

const PICKETS = Array.from({ length: 10 }, (_, i) => 206 + i * 7);

export default function HalloweenBackdrop() {
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
            cross together and the sky is quiet the rest of the cycle. */}
        <div className="hw-motion absolute inset-x-0 top-24 h-24" style={{ opacity: FG }}>
          <div className="hw-fly absolute start-0 top-0">
            <div className="hw-bob"><Witch /></div>
          </div>
          <Bat className="hw-fly hw-fly-b absolute start-0 top-10" />
          <Bat className="hw-fly hw-fly-c absolute start-0 top-1" />
          <Bat className="hw-fly hw-fly-d absolute start-0 top-16" />
        </div>
      </div>

      {/* Harvest moon: one disc in --primary at the declared strength. Kept
          clear of the flyover's lane so the two never stack. */}
      <svg className="absolute top-[42%] end-[8%] w-20 h-20" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="hsl(var(--primary))" opacity={MOON} />
      </svg>

      {/* Graveyard, cropped at the sides on wide screens rather than scaled
          up. Its foot meets the nav's top, so the ground runs behind the
          pumpkin row and the patch grows out of it. --nav-h already
          includes --skin-nav-edge; adding it again floated the whole
          graveyard up into the page's last lines. */}
      <svg
        className="absolute inset-x-0 bottom-[calc(var(--nav-h)-var(--skin-nav-edge,0px))] lg:bottom-0 w-full h-[clamp(96px,32vw,150px)]"
        viewBox="0 0 400 160"
        preserveAspectRatio="xMidYMax slice"
      >
        <g fill="currentColor" stroke="currentColor" strokeLinecap="round" style={{ opacity: FG }}>
          <path strokeWidth="0" d="M0 160L0 128Q60 110 130 122T260 118T400 124L400 160Z" />
          <path strokeWidth="0" d="M40 128v-22a10 10 0 0 1 20 0v22Z" />
          <path strokeWidth="0" d="M96 124v-30h-8v-6h8v-8h6v8h8v6h-8v30Z" />
          <path strokeWidth="0" d="M150 122v-18a13 13 0 0 1 26 0v18Z" transform="rotate(-6 163 122)" />
          <path strokeWidth="0" d="M300 122v-16a9 9 0 0 1 18 0v16Z" />
          {PICKETS.map((x) => (
            <path key={x} strokeWidth="0" d={`M${x} 121v-18l2.5-4 2.5 4v18Z`} />
          ))}
          <path strokeWidth="0" d="M204 107h70v2.5h-70ZM204 116h70v2.5h-70Z" />
          <path strokeWidth="0" d="M352 124C354 100 350 80 356 60L360 60C358 82 362 100 363 124Z" />
          <path fill="none" strokeWidth="3" d="M357 70Q340 55 326 52L318 44M358 64Q372 48 388 44L394 36M356 84Q344 76 334 78M361 78Q374 72 384 74" />
        </g>
      </svg>
    </div>
  );
}
