/**
 * i18n-settings-nav.js
 *
 * Translation keys for the Settings index and its seven subpages, added
 * when Settings moved out of the ProfileMenu dropdown onto its own route
 * (`/settings`, `/settings/:section`).
 *
 * Keys cover:
 *   - settings.section.*      — the seven index rows, each with a `.hint`
 *   - settings.group.*        — group headings inside the subpages
 *   - settings.stat.* / .sex.* — body-stat row labels
 *   - a handful of previously-inline English strings that had no key at
 *     all (privacy toggle titles and descriptions, story visibility,
 *     block-list controls, the export and build rows)
 *
 * TODO(i18n): English only. Per CLAUDE.md we don't ship
 * machine-translated copy, and this is 60+ keys of UI prose. Every call
 * site uses `tFallback(key, 'English')`, so non-English locales render
 * the English string rather than a key path until a native-speaker pass
 * lands. That is the same posture as the `recap.*` keys.
 *
 * No wiring needed: scripts/split-i18n.mjs discovers every
 * `src/lib/i18n-*.js` part file by name and merges it into the
 * per-language aggregates at build time.
 */

export const settingsNavI18n = {
  en: {
    // ── Index rows ────────────────────────────────────────────────────
    'settings.section.preferences':        'Preferences',
    'settings.section.preferences.hint':   'Language, units, appearance, haptics & sound',
    'settings.section.notifications':      'Notifications',
    'settings.section.notifications.hint': 'In-app alerts, push, categories & quiet hours',
    'settings.section.training':           'Training',
    'settings.section.training.hint':      'Auto-pause, rest timer & volume math',
    'settings.section.body':               'Body & nutrition',
    'settings.section.body.hint':          'Weight, height, age, sex & nutrition display',
    'settings.section.privacy':            'Privacy & safety',
    'settings.section.privacy.hint':       'Who sees you, stories, blocked & muted accounts',
    'settings.section.account':            'Account',
    'settings.section.account.hint':       'Two-factor auth, connected apps & data export',
    'settings.section.about':              'About',
    'settings.section.about.hint':         'Report a bug, build version & credits',

    // ── Group headings ────────────────────────────────────────────────
    'settings.group.units':           'Units',
    'settings.group.display':         'Display',
    'settings.group.feedback':        'Feedback',
    'settings.group.inApp':           'In the app',
    'settings.group.push':            'Push notifications',
    'settings.group.push.desc':       'Delivered when the app is closed. Per-device.',
    'settings.group.session':         'During a session',
    'settings.group.volumeMath':      'Volume math',
    'settings.group.bodyStats':       'Body stats',
    'settings.group.bodyStats.desc':  'Calibrates calorie targets, starting weights and strength ceilings.',
    'settings.group.nutrition':       'Nutrition',
    'settings.group.visibility':      'Visibility',
    'settings.group.stories':         'Stories',
    'settings.group.blocked':         'Blocked & muted',
    'settings.group.yourData':        'Your data',
    'settings.group.help':            'Help',
    'settings.group.about':           'About',

    // ── Appearance + feedback ─────────────────────────────────────────
    'settings.appearance.light':      'Light',
    'settings.appearance.dark':       'Dark',
    'settings.inAppAlerts.hint':      'Toasts while the app is open',

    // ── Body stats ────────────────────────────────────────────────────
    'settings.stat.weight':      'Weight',
    'settings.stat.height':      'Height',
    'settings.stat.heightHint':  'Height (inches, e.g. 70 = 5\'10")',
    'settings.stat.age':         'Age',
    'settings.stat.dob':         'Date of birth',
    'settings.sex.male':         'Male',
    'settings.sex.female':       'Female',
    'settings.cycleTracking.hint': 'Shows the tracker on Progress › Body',

    // ── Privacy ───────────────────────────────────────────────────────
    'settings.privateProfile.title':  'Private profile',
    'settings.privateProfile.desc':   'Only followers see your level, workouts, and progress photos.',
    'settings.hideFromSearch.title':  'Hide from search',
    'settings.hideFromSearch.desc':   'Your account won\'t appear in search results or "People you may know."',
    'settings.gymRival.title':        'Opt out of Gym Rival',
    'settings.gymRival.desc':         'Stop being matched with a weekly Gym Rival to compete against.',

    // ── Stories + block lists ─────────────────────────────────────────
    'settings.story.defaultVisibility': 'Default story visibility',
    'settings.story.friendsOnly':       'Friends',
    'settings.story.public':            'Public',
    'settings.story.blockedAccounts':   'Blocked from my stories',
    'settings.block.placeholder':       'Email to block…',
    'settings.block.action':            'Block',
    'settings.block.empty':             'No accounts blocked.',
    'settings.block.undo':              'Unblock',
    'settings.mute.undo':               'Unmute',
    'settings.blockedUsers.title':      'Blocked users',
    'settings.mutedUsers.title':        'Muted users',
    'settings.myReports.title':         'My reports',

    // ── Account + about ───────────────────────────────────────────────
    'settings.export.action':      'Download my data',
    'settings.export.busy':        'Preparing export…',
    'settings.export.hint':        'Everything on your account, as a JSON file',
    'settings.admin.reportQueue':  'Open report queue',
    'settings.build.hint':         'Tap to copy build info for a support ticket',
    'settings.tips.reset':         'Show one-time tips again',
    'settings.tips.resetHint':     'The hints that appear once and never again — long-press shortcuts, double-tap to react',
    'settings.tips.resetNone':     'No tips to bring back — none have shown on this device yet',
    'settings.tips.resetDone':     'Tips reset. They will show again the next time you reach each one.',

    // ── Quiet hours a11y labels ───────────────────────────────────────
    'settings.quiet.startLabel': 'Quiet hours start (24-hour clock)',
    'settings.quiet.endLabel':   'Quiet hours end (24-hour clock)',
  },
};
