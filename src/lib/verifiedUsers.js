// The developers' easter eggs: the crown, the poop joke and the three
// long-press games. Kept on purpose (Kegan, 2026-09-30: "a little easter egg
// planted by the devs").
//
// Keyed on account ids, not handles. They used to match usernames, and a
// handle can be changed every 30 days and none of these were reserved, so
// whoever claimed a freed handle inherited the crown or had their bio
// replaced. Several had already drifted: two of the accounts they were made
// for had changed or never set the handle, so their egg showed for nobody.
// An id never moves to another person.
const KEGAN = '39d05494-23f1-4678-9c94-33aa95d8f041';
const SEAN = 'ead69f89-3a1e-4bf2-9d3e-444648e01f98';
const JACKSON = '36babba9-33eb-44f1-bf4f-1f97a5df030b';
const JAMES = 'f0be8c26-64b8-4451-b5f3-70c89cb4160b';
const FRANK = '2b2782a3-d418-43a1-a9f6-bfc69446254a';

const has = (set) => (userId) => !!userId && set.has(String(userId));

// Crown. Cosmetic only: admin rights live in the server's admin_users table.
export const VERIFIED_IDS = new Set([KEGAN, SEAN]);
export const isVerified = has(VERIFIED_IDS);

export const POOP_IDS = new Set([JAMES, JACKSON]);
export const isPoop = has(POOP_IDS);

// Long press on the avatar.
export const hasSnakeEgg = has(new Set([SEAN]));
export const hasBirdEgg = has(new Set([KEGAN]));
export const hasSweatEgg = has(new Set([FRANK, JACKSON]));
