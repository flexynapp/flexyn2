// src/components/skins/halloween/index.jsx
//
// The Halloween skin's parts. Its data (window, copy) is the `halloween`
// entry in src/lib/skins.js; the slot contract is in ../parts.js.

import './halloween.css';
import HalloweenBackdrop from './HalloweenBackdrop';
import PumpkinPatch from './PumpkinPatch';
import PumpkinMark from './PumpkinMark';
import Ghost from './Ghost';

function LogoMark() {
  return <PumpkinMark face className="w-5 h-5 -ms-1 self-start mt-0.5" />;
}

function Icon({ className = 'w-4 h-4' }) {
  return <PumpkinMark face className={className} />;
}

export default {
  Backdrop: HalloweenBackdrop,
  NavEdge: PumpkinPatch,
  LogoMark,
  Icon,
  EmptyAccent: Ghost,
};
