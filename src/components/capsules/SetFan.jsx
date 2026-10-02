// src/components/capsules/SetFan.jsx
//
// The sticker set as a small fanned hand of real stickers: the user's newest
// on top, then a couple they do not have yet, greyed, as a glimpse of what is
// still out there. `items` comes from setFan(). It replaced the set bar of
// rarity segments, which said how much was owned but never showed a sticker.
//
// `land` names the item that just dropped (the Opened screen): it starts
// lifted and invisible and settles onto the pile after `landDelay`, so the
// set visibly gains it. Reduced motion skips straight to the settled pile.

import { useEffect, useState } from 'react';
import Sticker from './Sticker';

export default function SetFan({ items, size = 30, land = null, landDelay = 0 }) {
  const [landed, setLanded] = useState(!land);
  useEffect(() => {
    if (!land) return undefined;
    const t = setTimeout(() => setLanded(true), landDelay);
    return () => clearTimeout(t);
  }, [land, landDelay]);
  const mid = (items.length - 1) / 2;
  return (
    <span className="flex items-center ps-1" aria-hidden="true" data-testid="set-fan">
      {items.map((s, i) => {
        const lifting = s.id === land && !landed;
        return (
          <span
            key={s.id}
            data-owned={s.owned ? 'true' : 'false'}
            className="block motion-safe:transition-[transform,opacity] motion-safe:duration-500 motion-safe:ease-out"
            style={{
              marginInlineStart: i ? -6 : 0,
              transform: `translateY(${lifting ? -14 : 0}px) rotate(${(i - mid) * 5}deg)`,
              opacity: lifting ? 0 : 1,
              zIndex: i,
            }}
          >
            <Sticker itemId={s.id} emoji={s.emoji} rarity={s.rarity} size={s.id === land ? size + 6 : size} dim={!s.owned} />
          </span>
        );
      })}
    </span>
  );
}
