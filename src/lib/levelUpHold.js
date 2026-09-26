// Lets a full-screen win hold back the global level-up overlay.
//
// Saving a workout can cross a level boundary. LevelUpManager notices when
// the profile's total_xp refetches, which lands somewhere around the save,
// and it used to open its overlay on top of the workout win screen that
// already shows "Level N unlocked" in its XP card. Two celebrations for
// one moment, the second hiding the first.
//
// The save holds level-ups before it starts. A level-up detected while held
// is parked, not shown. When the win screen closes it releases the hold and
// says whether it showed the level itself: if it did, the parked overlay is
// dropped; if not (the level came from somewhere else), it plays then.
// Capsule and coin grants never wait on this; only the overlay does.

let held = false;
let parked = null;
let show = null;

export function holdLevelUps() {
  held = true;
}

export function releaseLevelUps({ shownByWin = false } = {}) {
  held = false;
  const ev = parked;
  parked = null;
  if (ev && !shownByWin && show) show(ev);
}

// LevelUpManager routes each overlay event through here. Returns true when
// the event was parked instead of shown.
export function parkIfHeld(event) {
  if (!held) return false;
  parked = event;
  return true;
}

// LevelUpManager registers how to show a released event.
export function onReleasedLevelUp(fn) {
  show = fn;
  return () => { if (show === fn) show = null; };
}

export function _resetLevelUpHold() {
  held = false;
  parked = null;
  show = null;
}
