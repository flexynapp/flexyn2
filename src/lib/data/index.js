// src/lib/data/index.js
//
// THE DATA-ACCESS SEAM.
//
// Screens reach tables through the modules in this folder, one per table,
// importing either the module directly (`@/lib/data/workouts`) or the
// namespaces below. The old `db.entities.X` client is gone, and
// eslint.config.js makes any use of it a lint error. Nothing enforces the
// wider rule that screens never call supabase themselves; some still do.

export * as workouts from './workouts';
export * as cardio from './cardio';
export * as regimens from './regimens';
export * as goals from './goals';
export * as achievements from './achievements';
export * as bodyMetrics from './bodyMetrics';
export * as nutrition from './nutrition';
export * as templates from './templates';
export * as users from './users';
export * as me from './me';
export * as serverFunctions from './serverFunctions';
export * as cardioLimits from '../cardioLimits';
export * as foodItems from './foodItems';
export * as hubPosts from './hubPosts';
export * as hubFollows from './hubFollows';
export * as hubReactions from './hubReactions';
export * as hubComments from './hubComments';
export * as hubMessages from './hubMessages';
export * as capsules from './capsules';
export * as inventory from './inventory';
export * as marketplace from './marketplace';
export * as quests from './quests';
export * as loginStreak from './loginStreak';
export * as coinShop from './coinShop';
export * as leagues from './leagues';
export * as workoutStreak from './workoutStreak';
export * as notifications from './notifications';