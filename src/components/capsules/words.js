// src/components/capsules/words.js
//
// The capsule vocabulary, spelled out as literal keys. The orphan-key scan
// reads literal tFallback calls, so a key built from a template string would
// be invisible to it; each tier gets its own call instead.

import { RARITY } from '@/lib/lootCatalog';

export function tierName(tf, tier) {
  if (tier === 'premium') return tf('capsules.tier.premium', 'Premium');
  if (tier === 'elite') return tf('capsules.tier.elite', 'Elite');
  return tf('capsules.tier.standard', 'Standard');
}

export function tierFinish(tf, tier) {
  if (tier === 'premium') return tf('capsules.finish.premium', 'Polished silver');
  if (tier === 'elite') return tf('capsules.finish.elite', 'Polished gold');
  return tf('capsules.finish.standard', 'Polished bronze');
}

// What each tier is for, in words the published odds support: premium rolls
// rare or better 27% of the time, elite 65%.
export function tierBlurb(tf, tier) {
  if (tier === 'premium') return tf('capsules.blurb.premium', 'Better odds at rare and epic');
  if (tier === 'elite') return tf('capsules.blurb.elite', 'Rare or better about two times in three');
  return tf('capsules.blurb.standard', 'The everyday pull');
}

export function rarityName(tf, rarity) {
  const en = RARITY[rarity]?.label ?? RARITY.common.label;
  switch (rarity) {
    case 'uncommon': return tf('loot.rarity.uncommon', en);
    case 'rare': return tf('loot.rarity.rare', en);
    case 'epic': return tf('loot.rarity.epic', en);
    case 'legendary': return tf('loot.rarity.legendary', en);
    case 'mythic': return tf('loot.rarity.mythic', en);
    case 'animated': return tf('loot.rarity.animated', en);
    default: return tf('loot.rarity.common', en);
  }
}
