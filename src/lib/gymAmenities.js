// src/lib/gymAmenities.js
//
// Controlled vocabulary for gym amenities. Slug → { label, emoji }.
// Owners pick from this list in the edit form so we don't get
// freeform "Showers" vs "showers" vs "Shower facility" drift.
//
// Adding to this list is safe — existing gyms keep their already-
// selected slugs and the UI just renders unknown slugs with a
// fallback (slug + ✓ emoji) inside GymAboutCard.

export const AMENITY_META = {
  parking:           { label: 'Parking',            emoji: '🅿️' },
  showers:           { label: 'Showers',            emoji: '🚿' },
  lockers:           { label: 'Lockers',            emoji: '🔒' },
  sauna:             { label: 'Sauna',              emoji: '🧖' },
  steam_room:        { label: 'Steam room',         emoji: '♨️' },
  cardio_zone:       { label: 'Cardio zone',        emoji: '🏃' },
  free_weights:      { label: 'Free weights',       emoji: '🏋️' },
  rack_zone:         { label: 'Squat racks',        emoji: '🦵' },
  platform:          { label: 'Lifting platform',   emoji: '🔩' },
  classes:           { label: 'Group classes',      emoji: '👥' },
  yoga_studio:       { label: 'Yoga studio',        emoji: '🧘' },
  pool:              { label: 'Swimming pool',      emoji: '🏊' },
  personal_training: { label: 'Personal training',  emoji: '🎯' },
  childcare:         { label: 'Childcare',          emoji: '🧒' },
  juice_bar:         { label: 'Juice bar',          emoji: '🥤' },
  wifi:              { label: 'Wifi',               emoji: '📶' },
  open_24_7:         { label: 'Open 24/7',          emoji: '🕐' },
  outdoor_area:      { label: 'Outdoor space',      emoji: '🌳' },
  combat:            { label: 'Combat / MMA',       emoji: '🥊' },
  climbing:          { label: 'Climbing wall',      emoji: '🧗' },
};

export const AMENITY_SLUGS = Object.keys(AMENITY_META);
