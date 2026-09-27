// src/components/skins/SkinSlot.jsx
//
// Renders one slot of the active skin, or nothing. The app places these at
// fixed points (App.jsx, Layout's nav, Header) and never names a skin, so a
// new skin needs no edits outside its own folder and the two registries.

import { useSkin } from './useSkin';

export default function SkinSlot({ name, ...props }) {
  const { on, parts } = useSkin();
  const Part = on ? parts?.[name] : null;
  return Part ? <Part {...props} /> : null;
}
