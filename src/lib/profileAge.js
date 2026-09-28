// src/lib/profileAge.js

/**
 * Age from the onboarding profile. Prefers `birthday` (which stays correct as
 * the user gets older) and falls back to the `age` column captured at signup.
 * Returns null rather than a guess when neither is usable, so callers can
 * decide — a wrong age silently scaling someone's weights is worse than none.
 */
export function profileAge(profile = {}) {
  if (profile?.birthday) {
    const birth = new Date(profile.birthday);
    if (!Number.isNaN(birth.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
      if (years >= 0 && years < 120) return years;
    }
  }
  const a = Number(profile?.age);
  return Number.isFinite(a) && a > 0 && a < 120 ? a : null;
}
