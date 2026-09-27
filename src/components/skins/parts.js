// src/components/skins/parts.js
//
// Skin id → the React parts that skin supplies. Each skin's folder exports
// an object with any of these slots; a slot it leaves out renders nothing.
//
//   Backdrop     fixed scene BEHIND page content (-z-10). Shows only in the
//                gaps between cards, which is the point: it fills empty
//                space and can never cover anything. Every figure, moving
//                or not, goes here. Drawn at the skin's declared `ink`.
//   NavEdge      a row on the bottom nav's top edge that slides with it.
//                The skin must declare --skin-nav-edge in its CSS; Layout
//                reserves that much room, and the row must fit inside it.
//   LogoMark     small mark beside the header logo.
//   Icon         the skin's icon for its switch rows and offer card. Takes
//                className; must render at w-4 h-4.
//   EmptyAccent  a small figure placed at the corner of every EmptyState
//                icon, so empty screens join in.
//
// There is deliberately NO slot above the page. The old themes cut content
// off because their decorations sat on top of it. skinFit.test.js holds
// that line.
//
// Registering a skin = one import and one line here, plus its data entry in
// src/lib/skins.js. See docs/skins.md.

import halloween from './halloween/index.jsx';

export const SKIN_PARTS = {
  halloween,
};

export const SKIN_SLOTS = ['Backdrop', 'NavEdge', 'LogoMark', 'Icon', 'EmptyAccent'];
