export const VERIFIED_HANDLES = new Set(['kegan', 'sean', 'keganbergeron']);
export const isVerified = (username) => VERIFIED_HANDLES.has((username || '').toLowerCase());
