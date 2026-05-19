export const VERIFIED_HANDLES = new Set(['kegan', 'sean']);
export const isVerified = (username) => VERIFIED_HANDLES.has((username || '').toLowerCase());
