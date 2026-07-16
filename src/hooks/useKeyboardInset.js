import { useEffect, useState } from 'react';

// Pixels of the layout viewport currently covered by the on-screen keyboard,
// via the VisualViewport API. Returns 0 where unsupported or the keyboard is
// closed.
//
// Why: on iOS a bottom-sheet modal with inputs near the bottom triggers the
// browser to scroll the *document* to reveal the focused field, which drags
// the fixed overlay up and exposes the page behind it. Applying this value as
// `padding-bottom` on the sheet's own scroll container lets the focused field
// scroll into view WITHIN the sheet instead — the document stays put, the
// overlay keeps covering, and no page bleeds through beneath the keyboard.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const update = () => {
      // How much shorter the visual viewport is than the layout viewport,
      // including any offset the browser applied to reveal a focused input.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Floor small values so address-bar chrome collapsing isn't mistaken for
      // a keyboard (real soft keyboards are ~250px+).
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
