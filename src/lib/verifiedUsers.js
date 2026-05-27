export const VERIFIED_HANDLES = new Set(['kegan', 'sean', 'keganbergeron']);
export const isVerified = (username) => VERIFIED_HANDLES.has((username || '').toLowerCase());

export const POOP_HANDLES = new Set(['jamesjpavlik', 'jackson']);
export const isPoop = (username) => POOP_HANDLES.has((username || '').toLowerCase());
