// Home gym ("My Gym") i18n — migration 275.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-
// translated copy, and several of these strings carry meaning a literal
// translation loses, so they want a native-speaker pass rather than an
// LLM one. Every call site uses tFallback('key', 'English'), so an
// untranslated language renders correct English rather than a key code.
//
// Notes for whoever translates this:
//
//   • myGym.title vs profile.myGyms — "My Gym" (singular) is the ONE
//     gym the user trains at; "My Gyms" (plural, in i18n-gym*.js) is the
//     list of every gym they've joined. If a language collapses these
//     into the same phrase, two different menu items become identical.
//     Prefer something like "My home gym" over a bare singular if that
//     is what disambiguates in your language.
//
//   • myGym.communityNote — "community gym" is a status, not a category
//     of gym: it means members added it and the business hasn't claimed
//     it. Translating it as "public gym" or "shared gym" changes the
//     meaning and makes the listing look official when it isn't.
//
//   • myGym.rankedBy / myGym.footer — the point of the copy is that
//     TURNING UP is what scores, not how much you lift. That reassurance
//     is the reason the board ranks by days rather than volume; keep it.
//
//   • myGym.gymDays — distinct days on which any member trained, summed
//     across members. Not "days the gym was open".

export default {
  en: {
    'profile.myGym': 'My Gym',

    'myGym.title': 'My Gym',
    'myGym.subtitle': 'Your home gym and the people who train there.',
    'myGym.change': 'Change',
    'myGym.onFlexyn': 'on Flexyn',
    'myGym.member': 'Member',
    'myGym.you': 'YOU',
    'myGym.day': 'day',
    'myGym.days': 'days',

    'myGym.communityProgress': 'Community progress',
    'myGym.last7': 'Last 7 days',
    'myGym.ofMembersTrained': 'of',
    'myGym.trainedThisWeek': 'members trained this week',
    'myGym.sessions': 'sessions',
    'myGym.gymDays': 'gym days',
    'myGym.volumeLbs': 'lbs moved',

    'myGym.leaderboard': 'Gym leaderboard',
    'myGym.rankedBy': 'Days trained · last 7 days',
    'myGym.boardEmpty':
      "Nobody here has logged a workout this week. Be the first — you'll take the top spot.",
    'myGym.footer': 'Ranked by days trained, so showing up is what counts.',

    'myGym.emptyTitle': "You haven't picked a gym yet",
    'myGym.emptyBody':
      'Choose the gym you train at to see a leaderboard with everyone else who trains there — and put your gym on the Flexyn map.',
    'myGym.emptyCta': 'Find my gym',

    'myGym.pickTitle': 'Which gym do you train at?',
    'myGym.pickBody':
      "Pick it below and you'll get a leaderboard with everyone else who trains there — plus a bubble on the Flexyn map. You can change it any time.",
    'myGym.pickEmptyHint':
      'Nothing is mapped within a few kilometres of you. Try the map instead — you can search anywhere in the country.',
    'myGym.setAs': 'Set as my gym',
    'myGym.browseMap': 'Browse the map instead',

    'myGym.goneTitle': 'That gym is no longer listed',
    'myGym.goneBody':
      'The gym you picked is no longer active on Flexyn. Pick another from the map.',

    'myGym.communityNote':
      'Community gym — added by Flexyn members, not claimed by the business yet.',
  },
};
