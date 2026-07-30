// Equipment-picker i18n.
//
// TODO(i18n): ENGLISH ONLY — needs a native-speaker pass for the other
// 14 locales (es fr de pt it ja ko zh ar hi ru tr pl nl). Per CLAUDE.md
// we don't ship machine-translated copy, so the missing locales fall
// back to these English strings via tFallback at the call site. That is
// the intended interim state, not an oversight.
//
// Translator notes:
//
//  • "implement" in the code means the specific piece of equipment a
//    lifter is using — a named machine, a pair of dumbbells, a bar.
//    User-facing copy never says "implement"; it says "equipment".
//
//  • BRAND AND MODEL NAMES ARE NOT TRANSLATED. "Hammer Strength",
//    "Bowflex SelectTech 552", "Cybex Eagle" are proper nouns and are
//    generated from src/lib/equipmentCatalog.js, not from this file.
//
//  • `implement.atGymNamed` takes a {gym} placeholder holding the gym's
//    own name. Keep the placeholder and put it wherever the target
//    language wants it — do not translate it into "At" + name, which
//    only works in English word order.
//
//  • `gymEquip.confirmed` / `gymEquip.byGym` are trust badges on a gym's
//    equipment list: "Confirmed" = the gym's owner vouched for a member's
//    entry; "Listed by the gym" = the owner added it themselves.

export const equipmentI18n = {
  en: {
    // ── The picker, inside an active workout ──
    'implement.choose':           'Choose equipment',
    'implement.add':              'Add equipment',
    'implement.clear':            'Clear',
    'implement.search':           'Search brands and models',
    'implement.yourGear':         'Your equipment',
    'implement.atGymNamed':       'At {gym}',
    'implement.atYourGym':        'At your gym',
    'implement.catalog':          'Common models',
    'implement.addCustom':        'Add your own',
    'implement.customPlaceholder': 'e.g. Atlantis leg press',
    'implement.save':             'Save',
    'implement.empty':            'No models listed for this yet — add yours below.',
    'implement.noMatch':          'No match — add it below.',
    // ── Photos ──
    'implement.addPhoto':         'Add a photo',
    'implement.replacePhoto':     'Replace photo',
    'implement.yourPhoto':        'Your photo',
    'implement.noPhoto':          'No photo yet',
    'implement.photoSaved':       'Photo added',
    'implement.photoType':        'Pick an image file.',
    'implement.photoFailed':      "Couldn't upload that photo.",
    // ── A gym's equipment floor ──
    'gymEquip.add':               'Add equipment',
    'gymEquip.added':             'Added to the floor',
    'gymEquip.save':              'Add',
    'gymEquip.remove':            'Remove',
    'gymEquip.confirm':           'Confirm this is on the floor',
    'gymEquip.unconfirm':         'Remove confirmation',
    'gymEquip.confirmed':         'Confirmed',
    'gymEquip.byGym':             'Listed by the gym',
    'gymEquip.pickType':          'What kind of equipment?',
    'gymEquip.pickBrand':         'Brand',
    'gymEquip.linePlaceholder':   'Series or model (optional)',
    'gymEquip.emptyTitle':        'No equipment listed yet',
    'gymEquip.emptyMine':         "Add what's on the floor — it'll show up in everyone's workout picker.",
    'gymEquip.emptyOther':        'Nobody has described this gym’s floor yet.',
    'gymEquip.addFailed':         "Couldn't add that.",
    'gymEquip.verifyFailed':      "Couldn't update that.",
    'gymEquip.removeFailed':      "Couldn't remove that.",
  },
};
