// src/components/skins/parts.js
//
// Skin id → the React parts that skin supplies. Each skin's folder exports
// an object with any of these slots; a slot it leaves out renders nothing.
//
//   Overlay      fixed ornaments ABOVE page content, below header/dialogs
//                (z-35). Webs, a flyover. Never takes a tap.
//   Backdrop     fixed scene BEHIND page content (-z-10). Shows only in the
//                gaps between cards, which is the point: it fills empty
//                space without covering anything.
//   NavEdge      sits on the top edge of the bottom nav and slides with it.
//   LogoMark     small mark beside the header logo.
//   Icon         the skin's icon for its switch rows and offer card. Takes
//                className; must render at w-4 h-4.
//   EmptyAccent  a small figure placed at the corner of every EmptyState
//                icon, so empty screens join in.
//
// Registering a skin = one import and one line here, plus its data entry in
// src/lib/skins.js. See docs/skins.md.

import halloween from './halloween/index.jsx';

export const SKIN_PARTS = {
  halloween,
};

export const SKIN_SLOTS = ['Overlay', 'Backdrop', 'NavEdge', 'LogoMark', 'Icon', 'EmptyAccent'];
