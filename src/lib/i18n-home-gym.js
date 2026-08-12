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
//   • myGym.title — "My Gym" is now BOTH: the one gym the user trains at
//     (the top of the page) and every gym they've joined (below the
//     break). It was two pages and two menu entries, "My Gym" and "My
//     Gyms", until 2026-08-09. A singular title is right — the page leads
//     with the one gym — but if your language forces a choice, favour the
//     reading that covers both over a strict singular.
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
    // Covers the whole page, not just the hero — the joined-gyms list
    // moved under here when /my-gyms was folded in.
    'myGym.subtitle': "Your floor, your people, and every gym you've joined.",

    'myGym.communityProgress': 'Community progress',

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
    // "Tap it", not "Pick it": one tap commits here, with an Undo on the
    // toast. The old wording implied a second, confirming step that the
    // screen no longer has.
    'myGym.pickBody':
      "Tap it below and you'll get a leaderboard with everyone else who trains there — plus a bubble on the Flexyn map. You can change it any time.",
    // No radius claim here on purpose — the picker states the distance it
    // actually searched directly above this line. This one had said "within
    // a few kilometres", which stopped being true when the search started
    // reaching 30 miles, and it was OVERRIDING the real figure rather than
    // sitting under it.
    'myGym.pickEmptyHint':
      'Try the map instead — you can search anywhere in the country.',

    'myGym.goneTitle': 'That gym is no longer listed',
    'myGym.goneBody':
      'The gym you picked is no longer active on Flexyn. Pick another from the map.',

    'myGym.communityNote':
      'Community gym — added by Flexyn members, not claimed by the business yet.',

    // Member directory (GymHub → the member-count chip). {date} is
    // already localised by Intl.DateTimeFormat before it lands here, so
    // translate the sentence around it and leave the placeholder alone.
    // Word order is the point of making this a key at all: several
    // languages put the date before the verb.
    'gymMembers.joined': 'Joined {date}',
  },
};
