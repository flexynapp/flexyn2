// src/lib/data/index.js
//
// THE DATA-ACCESS SEAM.
//
// All NEW code must import from this module instead of calling base44 directly.
// Existing code that calls `base44.entities.X` is grandfathered; migrate
// incrementally as files get touched.
//
// On migration to a different backend (Firebase, Supabase, custom Node, etc.):
// rewrite the modules in this folder. Components and pages don't need to change.

export * as workouts from './workouts';
export * as cardio from './cardio';
export * as regimens from './regimens';
export * as goals from './goals';
export * as achievements from './achievements';
export * as bodyMetrics from './bodyMetrics';
export * as nutrition from './nutrition';
export * as templates from './templates';
export * as exerciseForms from './exerciseForms';
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