/**
 * Guards from the profile audit (2026-09-30). Each was a real defect found
 * by reading the page, and each is a one-line regression.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const profile = read('src/components/hub/HubProfile.jsx');
const uploader = read('src/components/AvatarUploader.jsx');

describe('profile audit guards', () => {
  // A supabase builder is a thenable without .catch(). Calling it threw
  // after the photo had saved, so every upload reported failure.
  it('never calls .catch() on a supabase chain in the avatar uploader', () => {
    expect(uploader).not.toMatch(/\.eq\([^)]*\)\s*\.catch\(/);
  });

  // An event fired beside navigate('/hub') from /profile lands before Hub
  // mounts. Router state is what Hub reads.
  it('opens the crew war through router state, not a window event', () => {
    expect(profile).not.toContain("new CustomEvent('flexyn:open-crew'");
    expect(profile).toMatch(/state: \{ openCrewId: heroWar\.crewId \}/);
  });

  it('says a private profile is private instead of drawing an empty one', () => {
    expect(profile).toMatch(/'is_private',\s*\n?\s*\]/);
    expect(profile).toMatch(/isHiddenPrivate \? \(/);
  });

  it('refreshes the signed-in user after a handle change', () => {
    const body = profile.slice(profile.indexOf('const commitUsername'), profile.indexOf('const messages = {'));
    expect(body).toMatch(/await checkUserAuth\?\.\(\);/);
  });

  it('never toasts a raw error message from the profile save', () => {
    expect(profile).not.toMatch(/toast\.error\(err\?\.message/);
  });

  it('does not print a guessed level for a hidden follower', () => {
    expect(profile).toMatch(/level: u\.total_xp == null \? null :/);
  });
});
