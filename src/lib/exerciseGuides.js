// src/lib/exerciseGuides.js
//
// A written step-by-step guide for EVERY exercise the app can offer.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// `exercisePoses.js` draws 39 movements. The catalog holds 396. So the "How to
// do it" disclosure rendered nothing for ~90% of what a user can be programmed
// — including Squat and Deadlift, which are the first two lifts in the default
// starter plan. Someone new opened their plan, saw a guide under Overhead
// Press and nothing under the squat above it, and reasonably concluded the
// feature was broken.
//
// Drawing 357 more figures is not the fix. Joint-angle poses are authored by
// hand and checked by eye (see the header of exercisePoses.js), so the set
// grows slowly and will always trail the catalog. Words scale; the figure
// stays the bonus it always was.
//
// ── Why patterns rather than 396 entries ────────────────────────────────────
//
// The catalog is named systematically — `<modifier> <implement> <movement>` —
// and the *movement* is what a guide describes. "Smith Machine Incline Bench
// Press", "Incline Dumbbell Press" and "Incline Bench Press" are one set of
// instructions with three setups. So a guide is a MOVEMENT PATTERN plus an
// implement-aware first step, which is 60-odd entries instead of 396 and, more
// importantly, 60-odd entries that a human can actually keep correct.
//
// This mirrors `exerciseEquipment.js`, which classifies the same catalog by
// name regex for the same reason and documents the same trade.
//
// ── The rules for editing this file ─────────────────────────────────────────
//
// 1. ORDER MATTERS — first match wins. `Close-Grip Push-Up` must reach
//    `push-up` before `bench-press`; `Jefferson Curl` must reach its own entry
//    before `curl`; `Calf Raise in Leg Press` must reach `calf-raise` before
//    `leg-press`. Every one of those is a real name in the catalog. If you add
//    a pattern, run `npm run test -- exerciseGuides` — the suite asserts the
//    resolved pattern for the whole library, so a reordering that steals a
//    name from another pattern fails loudly instead of silently teaching
//    someone the wrong movement.
//
// 2. NEVER GUESS. A wrong instruction is worse than no instruction — that is
//    the same reasoning that keeps `Squat`, `Deadlift` and `Chin-up` out of
//    the pose ALIASES. If a name doesn't map to a pattern you are confident
//    about, `guideFor` returns null and the panel renders nothing, which is a
//    visibly empty result the user can act on. Do not add a catch-all.
//
// 3. A STEP IS A CUE, NOT A SENTENCE ABOUT LIFTING. "Lower under control" is
//    filler. "Lower until the bar touches your chest, elbows about 45° from
//    your ribs" is a cue. Four honest steps beat six padded ones.
//
// TODO(i18n): these are English and are the single source, so `tFallback`
// resolves to them until a translator adds `exerciseGuide.*` to a part file.
// Per CLAUDE.md this is prose on a prominent surface, so English-only beats
// machine translation — but it IS English in all 15 languages today, and that
// is not "done".

import { classifyEquipment } from '@/lib/exerciseEquipment';

/**
 * Implement axis for the setup line. `classifyEquipment` already answers this
 * for the whole catalog and is tested; the one distinction it doesn't draw
 * that a setup line needs is a Smith machine (fixed bar path, racked at a
 * height you choose) from a selectorised machine.
 */
function implementOf(name) {
  if (/\bsmith\b/i.test(name)) return 'smith';
  return classifyEquipment(name);
}

// ── The patterns ────────────────────────────────────────────────────────────
//
// { id, match, setup, setupWhen?, setupBy?, steps, watch }
//
//   setup      first step, the default
//   setupWhen  [regex, replacement] pairs tried first, in order — for
//              modifiers that change the setup itself (kneeling, wall, side)
//   setupBy    keyed by implement, tried after setupWhen
//   steps      everything after the setup
//   stepsWhen  [regex, replacement steps, replacement watch?] — for the handful
//              of variants where the SETUP is shared but the movement genuinely
//              isn't (a Zottman curl rotates at the top; a clap push-up leaves
//              the floor). Reach for this only when a modifier changes what the
//              lifter does, not how it feels — otherwise it is a new pattern.
//   watch      the single most common way this movement goes wrong
//
const PATTERNS = [
  // ── Named oddities, before anything generic can claim them ───────────────
  {
    id: 'jefferson-curl',
    match: /jefferson/,
    setup: 'Stand on a box holding a light weight at arm\'s length, feet together, knees soft but straight.',
    steps: [
      'Tuck your chin and roll down one vertebra at a time, letting the weight hang and your back round deliberately.',
      'Go only as far as you can control — the range is the point, not the load.',
      'Reverse it from the bottom up, stacking the spine one segment at a time until you stand tall.',
    ],
    watch: 'Loading it. This is a mobility drill done with the lightest weight in the gym; treat it like a lift and it stops being safe.',
  },
  {
    id: 'neck',
    match: /\bneck (curl|extension|bridge)\b|neck bridge/,
    setup: 'Lie on a bench with your head just off the end, supporting the weight (if any) with a folded towel.',
    steps: [
      'Move only the head — the rest of you stays completely still.',
      'Take it through a slow, comfortable range and pause for a beat at the end.',
      'Return under full control. Every rep should look identical to the last.',
    ],
    watch: 'Speed. Neck work is the one place where momentum has no upside at all — slow it down and drop the load.',
  },
  {
    id: 'turkish-get-up',
    match: /turkish get[- ]?up/,
    setup: 'Lie on your back, one bell pressed straight up, same-side knee bent with the foot flat, other arm and leg out at 45°.',
    steps: [
      'Roll onto the free elbow, then push up onto that hand — eyes on the bell the whole time.',
      'Drive through the planted foot to lift your hips, then sweep the straight leg back into a half-kneeling position.',
      'Stand up from the lunge, keeping the arm locked out overhead.',
      'Reverse every step in order to get back to the floor.',
    ],
    watch: 'Rushing between positions. Each one is a stopping point you should be able to hold — if you can\'t, that\'s where the weight is too heavy.',
  },
  {
    id: 'get-up-floor',
    match: /prisoner get up/,
    setup: 'Lie flat on your back with your hands laced behind your head and elbows wide.',
    steps: [
      'Without using your hands, roll and post on a foot to bring yourself to a kneeling position.',
      'Stand all the way up, hands staying behind your head.',
      'Reverse it back to the floor under control rather than dropping.',
    ],
    watch: 'Unlacing the hands to push off the floor — that\'s the whole difficulty of the drill.',
  },
  {
    id: 'windmill',
    match: /windmill/,
    setup: 'Stand with a bell locked out overhead, feet wide, toes turned about 45° away from the loaded side.',
    steps: [
      'Push your hip out toward the loaded side and hinge sideways, eyes on the bell.',
      'Reach the free hand down the inside of your front leg as far as your hamstrings allow.',
      'Drive the hip back under you to stand, arm still locked out.',
    ],
    watch: 'Looking away from the bell. The moment your eyes leave it, the shoulder loses its position.',
  },
  {
    id: 'halo',
    match: /halo/,
    setup: 'Hold a bell upside down by the horns at chest height, elbows tucked in.',
    steps: [
      'Circle it around your head, keeping it close — it should nearly brush your ears.',
      'Keep your ribs down and your hips still; only the arms travel.',
      'Complete the circle, then reverse direction for the next rep.',
    ],
    watch: 'Leaning to let the bell past. If your torso moves, the circle is too wide or the bell is too heavy.',
  },
  {
    id: 'wall-walk',
    match: /wall walk/,
    setup: 'Lie face down with your feet against a wall and your hands under your shoulders.',
    steps: [
      'Press up and walk your feet up the wall while your hands step in toward it.',
      'Keep going until your chest is close to the wall and you are near-vertical.',
      'Reverse the walk with the same control — hands out, feet down.',
    ],
    watch: 'Letting the hips sag. Squeeze the glutes and keep one line from the ears to the heels the whole way up.',
  },
  {
    id: 'handstand-push-up',
    match: /handstand/,
    setup: 'Kick up to a handstand against a wall, hands slightly wider than the shoulders, heels resting on the wall.',
    steps: [
      'Bend the elbows and lower until the crown of your head lightly touches the floor.',
      'Press back up to a full lockout without letting the hips pike.',
      'Reset your balance between reps rather than rushing the next one.',
    ],
    watch: 'Piking at the hips to fake the range. If the line breaks, do them with your feet on a box instead.',
  },
  {
    id: 'burpee-press',
    match: /devils press/,
    setup: 'Stand with a dumbbell in each hand at your sides, feet hip-width.',
    steps: [
      'Set the bells down, jump or step back to a push-up position and lower your chest to the floor.',
      'Jump the feet back in and, in one motion, swing the bells between your legs and up overhead.',
      'Lock both arms out overhead with the ribs down, then bring them back to the floor for the next rep.',
    ],
    watch: 'Pulling with the arms on the way up. The bells travel because the hips snap — the arms just steer.',
  },
  {
    id: 'thruster',
    match: /thruster/,
    setup: 'Hold the weight in the front rack at shoulder height, elbows up, feet shoulder-width.',
    steps: [
      'Squat down to at least parallel, keeping the chest tall and the elbows high.',
      'Drive up hard, and as the hips finish, push the weight straight overhead in one continuous motion.',
      'Lock out overhead, then let it drop back to the rack and straight into the next squat.',
    ],
    watch: 'Squatting and pressing as two separate moves. The press is the tail end of the leg drive, not a fresh effort.',
  },

  // ── Olympic and explosive ────────────────────────────────────────────────
  {
    id: 'clean-and-jerk',
    match: /clean (and|&) jerk|ground to overhead/,
    setup: 'Set up over the bar as you would for a deadlift, shins close, shoulders just in front of it.',
    steps: [
      'Lift smoothly to the knee, then extend the hips and shrug hard to accelerate the bar.',
      'Pull under and catch it in the front rack, elbows high, absorbing in a quarter squat, then stand.',
      'Dip a few inches at the knees, drive up and punch the bar overhead as you split or drop under it.',
      'Recover to a stand with the bar locked out over the middle of your foot.',
    ],
    watch: 'Trying to muscle it up with the arms. Both halves are leg drive; the arms only change the bar\'s direction.',
  },
  {
    id: 'clean-and-press',
    match: /clean (and|&) press/,
    setup: 'Stand over the bell with feet hip-width and hinge to grip it.',
    steps: [
      'Pull it up close to the body and rotate your hand around it to land in the rack against your forearm.',
      'Stand tall with the ribs down and the elbow tucked in.',
      'Press it straight overhead to a full lockout, then lower back to the rack and down.',
    ],
    watch: 'Letting the bell flip over onto your wrist. Guide your hand around it rather than letting it swing around your hand.',
  },
  {
    id: 'jerk',
    match: /\bjerk\b/,
    setup: 'Start with the bar in the front rack, elbows high, feet directly under your hips.',
    steps: [
      'Dip straight down a few inches — vertical torso, no forward lean.',
      'Reverse hard and punch the bar overhead as your feet move into their catch position.',
      'Receive it with locked arms and the bar over the middle of your foot, then recover your feet to a stand.',
    ],
    watch: 'Dipping forward instead of straight down. The bar then travels away from you and there is no way to catch it overhead.',
  },
  {
    id: 'push-press',
    match: /push press/,
    setup: 'Hold the weight at shoulder height, elbows slightly in front of the bar, feet hip-width.',
    steps: [
      'Dip a few inches by bending the knees only, keeping the torso vertical.',
      'Drive up explosively and let that momentum start the weight overhead.',
      'Finish with the arms to a full lockout, head through, then lower back to the shoulders.',
    ],
    watch: 'A long, slow dip. It is a short, sharp countermovement — dip deep and the drive arrives too late to help.',
  },
  {
    id: 'kb-swing',
    match: /swing/,
    setup: 'Stand a foot behind the bell, feet slightly wider than the hips, and hinge to tip it back toward you.',
    steps: [
      'Hike it back between your legs, forearms against your inner thighs.',
      'Snap the hips forward hard and stand tall — the bell floats up on its own to about chest height.',
      'Let it fall, catch the load with your hips as it passes your legs, and go straight into the next rep.',
    ],
    watch: 'Squatting it up and lifting with the arms. This is a hinge: the knees barely bend and the arms are ropes.',
  },
  {
    id: 'kb-snatch',
    match: /kettlebell snatch/,
    setup: 'Set up as for a one-arm swing, bell a little in front of you, feet shoulder-width.',
    steps: [
      'Hike it back and snap the hips to send it up, keeping it close to your body.',
      'As it passes chest height, pull your elbow high and punch your hand through so the bell rolls around, not over, your wrist.',
      'Lock out overhead, then guide it back down into the next backswing.',
    ],
    watch: 'Letting the bell flip and bang your forearm — punch through earlier and keep it closer to your body.',
  },
  {
    id: 'snatch',
    // NOT "snatch grip" — that names a WIDE GRIP, not the lift. `Snatch Grip
    // Deadlift` and `Snatch Grip Behind the Neck Press` both matched here and
    // were handed instructions for catching a bar overhead.
    match: /\bsnatch\b(?! grip)/,
    setup: 'Grip the bar wide enough that it sits in your hip crease when you stand, shins close to it.',
    steps: [
      'Lift smoothly to the knee, keeping the bar over the middle of your foot.',
      'Extend the hips violently and shrug — the bar accelerates straight up, close to your body.',
      'Pull under it and catch it locked out overhead in a squat, then stand up with it.',
    ],
    watch: 'Yanking off the floor. The first pull is patient; all the speed belongs above the knee.',
  },
  {
    id: 'clean',
    match: /\bclean\b/,
    setup: 'Set up over the bar as you would for a deadlift, shoulders just in front of it, arms straight.',
    steps: [
      'Lift smoothly to the knee, keeping the bar close and your back angle unchanged.',
      'Extend the hips hard and shrug to accelerate it upward.',
      'Pull under and catch it in the front rack with the elbows driven high, absorbing in a quarter squat.',
      'Stand tall to finish the rep.',
    ],
    watch: 'Curling it in with the arms. If your elbows bend before the hips finish, the bar loops away from you.',
  },
  {
    id: 'jump',
    match: /box jump|jump squat|depth jump|jumping lunge|lateral bound/,
    setup: 'Start in an athletic stance, feet hip-width, knees soft, with room to land.',
    steps: [
      'Dip quickly into a quarter squat and swing the arms back.',
      'Jump as high (or as far) as you can, driving the arms up.',
      'Land quietly on the whole foot with the knees bent and tracking over the toes.',
      'Reset completely between reps — these are quality reps, not conditioning.',
    ],
    watch: 'Loud, stiff landings. If you can hear it, you are absorbing with your joints instead of your muscles.',
  },
  {
    id: 'ball-slam',
    match: /ball slam/,
    setup: 'Stand feet shoulder-width holding the ball, with a clear floor in front of you.',
    steps: [
      'Reach it overhead, extending tall through the hips.',
      'Slam it into the floor just in front of your feet, hinging and exhaling hard.',
      'Pick it up and go again without pausing to admire it.',
    ],
    watch: 'Throwing it too far forward, which turns a hinge into a chase.',
  },
  {
    id: 'med-ball-chest-pass',
    match: /chest pass/,
    setup: 'Stand a few feet from a wall or partner, ball at your chest, elbows tucked.',
    steps: [
      'Take a short dip at the knees.',
      'Push the ball off your chest explosively, finishing with the arms straight.',
      'Catch it soft, absorbing back to your chest, and go straight into the next one.',
    ],
    watch: 'A slow push. The point is speed — if it looks like a bench press, lighten the ball.',
  },

  // ── Grip, carries and forearms ───────────────────────────────────────────
  {
    id: 'carry',
    match: /farmers walk/,
    setup: 'Set the weights beside your feet and pick them up with a flat back, standing tall.',
    steps: [
      'Pull the shoulders down and back, brace your midsection and look ahead.',
      'Walk in short, quick steps for the set distance or time.',
      'Set the weights down deliberately rather than dropping them.',
    ],
    watch: 'Leaning back to counterbalance. Stack the ribs over the hips and let the trunk do the work.',
  },
  {
    id: 'hang',
    match: /bar hang/,
    setup: 'Take an overhand grip on a bar slightly wider than your shoulders and step or jump off.',
    steps: [
      'Let the shoulders relax up toward the ears at first, then gently pull them down away from them.',
      'Keep the ribs down and the legs still — no swinging.',
      'Hold for time, and step off before your grip fails rather than after.',
    ],
    watch: 'Hanging completely passive on a shoulder that hurts. If there is pinching, shorten the hold and keep the shoulders active.',
  },
  {
    id: 'gripper',
    match: /gripper/,
    setup: 'Set the handle deep in your palm with the fingers wrapped over the far handle.',
    steps: [
      'Close it fully until the handles touch, without letting your wrist bend.',
      'Hold the closed position for a beat.',
      'Open slowly rather than letting it spring apart.',
    ],
    watch: 'A shallow set in the hand. Seat it against the base of the palm first or you lose half your leverage.',
  },
  {
    id: 'plate-pinch',
    match: /plate pinch/,
    setup: 'Stand a plate (or two, smooth sides out) on end and pinch it between thumb and fingers.',
    steps: [
      'Stand tall with it hanging at arm\'s length by your side.',
      'Hold for time, resisting the plate rolling out of your fingers.',
      'Set it down under control before your grip gives out.',
    ],
    watch: 'Dropping plates on your feet. Do it over a mat and end the set early.',
  },
  {
    id: 'wrist-roller',
    match: /wrist roller/,
    setup: 'Hold the roller at arm\'s length in front of you at shoulder height, weight hanging on the cord.',
    steps: [
      'Roll the weight up using alternating wrist movements only — the arms stay still.',
      'When it reaches the top, roll it back down just as deliberately.',
      'Keep the elbows straight throughout.',
    ],
    watch: 'Letting the elbows drop as you fatigue, which hands the work to the shoulders.',
  },
  {
    id: 'wrist-curl',
    match: /wrist curl/,
    setup: 'Rest your forearms on a bench or your thighs, palms up, wrists just past the edge.',
    setupWhen: [
      [/behind the back/, 'Stand holding the bar behind your back at arm\'s length, palms facing away from you.'],
    ],
    steps: [
      'Let the weight roll down to your fingertips.',
      'Curl it back up by closing the fingers and then flexing the wrist as far as it will go.',
      'Lower slowly — the stretch is where the work is.',
    ],
    watch: 'Moving the forearms. If they lift off the bench, the weight is too heavy.',
  },
  {
    id: 'wrist-extension',
    match: /wrist extension/,
    setup: 'Rest your forearms on a bench or your thighs, palms DOWN, wrists just past the edge.',
    steps: [
      'Let the weight pull the hands down into a full stretch.',
      'Lift the backs of the hands toward the ceiling as far as they go.',
      'Lower slowly. Use much less weight than you would for a wrist curl.',
    ],
    watch: 'Loading it like a wrist curl. The extensors are far weaker — start light and stay light.',
  },

  // ── Hinge ────────────────────────────────────────────────────────────────
  {
    id: 'rdl',
    match: /romanian deadlift|stiff[- ]legged deadlift|single leg deadlift|death march/,
    setup: 'Stand tall holding the weight at your hips, feet hip-width, knees softly bent.',
    setupWhen: [
      [/single leg|one[- ]legged|death march/, 'Stand on one leg holding the weight, the free leg ready to travel back as a counterweight.'],
    ],
    steps: [
      'Push your hips straight back and let the weight slide down your thighs.',
      'Keep the back flat and the weight touching your legs the whole way; stop when your hamstrings say stop, usually mid-shin.',
      'Drive the hips forward to stand tall, squeezing the glutes at the top.',
    ],
    watch: 'Turning it into a squat. The knee angle barely changes — the hips move back, not down.',
  },
  {
    id: 'deadlift',
    match: /deadlift|rack pull/,
    setup: 'Stand with the bar over the middle of your feet, hip-width apart, and hinge down to grip it just outside your shins.',
    setupWhen: [
      [/sumo/, 'Take a wide stance with your toes turned out, bar over the middle of your feet, and grip inside your knees.'],
      [/trap bar/, 'Step into the middle of the trap bar, feet hip-width, and hinge down to take both handles.'],
      [/rack pull/, 'Set the pins just below or above your knees and take your normal deadlift stance at the bar.'],
      [/deficit/, 'Stand on a low platform so the bar starts below your normal position, then take your usual stance and grip.'],
    ],
    setupBy: {
      dumbbell: 'Stand with a dumbbell outside each foot, feet hip-width, and hinge down to grip them.',
      kettlebell: 'Stand over the bell with your feet hip-width and hinge down to take the handle in both hands.',
    },
    steps: [
      'Drop your hips until your shoulders are just in front of the weight, chest up, back flat, arms straight.',
      'Take the slack out, then push the floor away — keep the weight brushing your legs the whole way up.',
      'Stand tall by squeezing the glutes; do not lean back at the top.',
      'Return it by pushing the hips back first, then bending the knees once it passes them.',
    ],
    watch: 'The hips shooting up first, which leaves your back to lift the weight alone. Hips and shoulders should rise together.',
  },
  {
    id: 'good-morning',
    match: /good morning/,
    setup: 'Set the bar on your upper back as for a squat, feet hip-width, knees softly bent.',
    steps: [
      'Push the hips back and hinge forward with a flat back until your torso is near parallel to the floor.',
      'Feel the hamstrings load; go no further than you can hold the arch.',
      'Drive the hips forward to stand tall.',
    ],
    watch: 'Going heavy. This is a hamstring exercise done light — the spine is at the end of a long lever here.',
  },
  {
    id: 'back-extension',
    match: /back extension|hyperextension|superman/,
    setup: 'Set the pad at your hip crease so your hips can move freely, ankles secured.',
    setupWhen: [
      [/superman|floor back extension/, 'Lie face down on the floor with your arms extended in front of you.'],
      [/reverse hyper/, 'Lie face down on the bench with your hips at the edge and your legs hanging free.'],
    ],
    steps: [
      'Lower under control until you feel the hamstrings and glutes stretch.',
      'Squeeze the glutes to raise your torso back to a straight line with your legs.',
      'Stop at straight — do not arch past it.',
    ],
    watch: 'Hyperextending at the top to get a bigger range. The rep finishes when your body is in line.',
  },
  {
    id: 'hip-thrust',
    match: /hip thrust/,
    setup: 'Sit on the floor with your upper back against a bench, weight over your hips, feet flat and shin vertical at the top.',
    steps: [
      'Tuck your chin, drive through your heels and lift the hips until your torso is parallel to the floor.',
      'Squeeze the glutes hard for a full second at the top.',
      'Lower until the weight nearly touches the floor and go again.',
    ],
    watch: 'Finishing with an arched lower back instead of squeezed glutes. Keep the ribs down and the chin tucked.',
  },
  {
    id: 'glute-bridge',
    match: /glute bridge/,
    setup: 'Lie on your back, knees bent, feet flat and close enough that your fingertips brush your heels.',
    steps: [
      'Press through your heels and lift your hips to a straight line from knees to shoulders.',
      'Squeeze the glutes at the top and hold for a beat.',
      'Lower until your hips just touch the floor, then go again.',
    ],
    watch: 'Pushing through the toes, which hands the work to the hamstrings and brings on cramp.',
  },
  {
    id: 'frog-pump',
    match: /frog pump/,
    setup: 'Lie on your back with the soles of your feet together and your knees dropped out wide.',
    steps: [
      'Drive through the outside edges of your feet and lift the hips.',
      'Squeeze the glutes at the top — the range is short, so the squeeze is the rep.',
      'Lower and go again at a steady pace, high reps.',
    ],
    watch: 'Letting the knees close in. Keeping them wide is what puts the work in the glutes.',
  },
  {
    id: 'pull-through',
    match: /pull through/,
    setup: 'Face away from a low pulley, straddle the cable and hold the rope between your legs, walking out to take tension.',
    steps: [
      'Push your hips back and let the rope travel between your legs, keeping the back flat.',
      'Snap the hips forward to stand tall, finishing with a glute squeeze — the arms stay straight throughout.',
      'Control the return rather than being pulled back.',
    ],
    watch: 'Pulling with the arms into a row. The cable should feel like it moves because your hips moved.',
  },
  {
    id: 'nordic',
    match: /nordic|glute ham raise/,
    setup: 'Kneel with your ankles anchored, torso upright, hips locked straight.',
    setupWhen: [
      [/reverse nordic/, 'Kneel upright with your feet behind you and your hips locked straight.'],
      [/glute ham raise/, 'Set yourself in the GHD with your thighs on the pad and your feet locked between the rollers.'],
    ],
    steps: [
      'Lower yourself as slowly as you can, resisting the whole way — the hips stay extended, so this is one straight line.',
      'Catch yourself with your hands when you lose control.',
      'Push back to the start with your hands as needed; the lowering is the exercise.',
    ],
    watch: 'Breaking at the hips to make it easier. That turns it into a knee-friendly nothing — shorten the range instead.',
  },
  {
    id: 'hip-flexor',
    match: /hip march|hip flexor raise/,
    setup: 'Stand tall, feet hip-width, with the band or weight around the working foot and something to hold for balance.',
    steps: [
      'Lift the knee to hip height in a controlled march.',
      'Pause with the thigh parallel to the floor and the torso upright.',
      'Lower slowly without letting the standing side collapse.',
    ],
    watch: 'Leaning back to lift higher. The trunk stays vertical; the hip does the work.',
  },
  {
    id: 'hip-abduction',
    match: /abduction|side kick|lateral walk with band/,
    setup: 'Set the band or pad just above your knees and take a stance you can hold under tension.',
    setupWhen: [
      [/lateral walk/, 'Loop the band above your knees, drop into a quarter squat and turn your feet slightly in.'],
    ],
    steps: [
      'Drive the leg out to the side against the resistance.',
      'Pause at the end of the range where you feel the outer hip.',
      'Return slowly rather than letting the band snap you back.',
    ],
    watch: 'Rotating the whole body to get more range. Keep the hips square and accept the shorter travel.',
  },
  {
    id: 'hip-adduction',
    match: /adduction/,
    setup: 'Set the pad or strap against the inside of your working leg with your hips square.',
    steps: [
      'Pull the leg in across the midline against the resistance.',
      'Squeeze for a beat where the inner thigh is shortest.',
      'Let it travel back out slowly into a stretch, but not further than is comfortable.',
    ],
    watch: 'Starting from a stretch you have not earned. Set a modest range on the machine first.',
  },
  {
    id: 'clamshell',
    match: /clamshell/,
    setup: 'Lie on your side, knees bent about 90°, hips stacked, with a band above the knees if you have one.',
    steps: [
      'Keeping your feet together, open the top knee as far as it goes without the hip rolling back.',
      'Pause where you feel the side of the glute working.',
      'Close it slowly rather than letting the band snap your knees back together.',
    ],
    watch: 'Rolling the top hip backwards, which is your back doing the work instead of the glute.',
  },
  {
    id: 'quadruped-glute',
    match: /donkey kicks|fire hydrant/,
    setup: 'Get on all fours with hands under shoulders, knees under hips, and a flat back.',
    steps: [
      'Brace your midsection so the lower back cannot move.',
      'Drive the working leg back (or out to the side) to the top of its range.',
      'Pause and squeeze, then return without letting the knee touch down.',
    ],
    watch: 'Arching the lower back to get the leg higher. Range you buy from the spine is not range.',
  },
  {
    id: 'glute-kickback',
    match: /kickback|glute push down/,
    setup: 'Attach the strap or set the pad on the working leg and hold the frame with your torso still.',
    steps: [
      'Drive the leg back and slightly up, keeping it near-straight.',
      'Squeeze the glute hard at the top for a beat.',
      'Bring it back forward slowly under tension.',
    ],
    watch: 'Swinging your torso forward to move the weight. Lock the trunk and shorten the range.',
  },

  // ── Knee-dominant ────────────────────────────────────────────────────────
  {
    id: 'calf-raise',
    match: /calf raise|heel raise|heel drop/,
    setup: 'Put the balls of your feet on the edge of a step or platform with your heels free to drop.',
    setupWhen: [
      [/seated/, 'Sit with the pad across your thighs and the balls of your feet on the platform, heels free.'],
      [/leg press/, 'Sit in the leg press and place the balls of your feet on the bottom edge of the plate, heels off it.'],
      [/donkey/, 'Hinge forward at the hips with your forearms on a support, balls of the feet on a step, heels free.'],
    ],
    steps: [
      'Let the heels sink below the step into a full stretch and pause there.',
      'Press up onto the toes as high as you can and hold the top for a beat.',
      'Lower slowly. The pause at both ends is what makes calves respond.',
    ],
    watch: 'Bouncing. Calves are built out of tendon that will happily do this for you if you let it — pause and they can\'t.',
  },
  {
    id: 'tibialis',
    match: /tibialis|heel walk/,
    setup: 'Stand with your back against a wall, heels a foot or so out from it.',
    setupWhen: [
      [/heel walk/, 'Stand tall and lift your toes off the floor so you are balanced on your heels.'],
      [/kettlebell/, 'Sit on a bench with a light bell hooked over the top of your foot and your heel on the floor.'],
    ],
    steps: [
      'Pull the toes up toward your shins as far as they will travel.',
      'Hold the top for a beat where the front of the shin is working hard.',
      'Lower slowly rather than letting the feet drop.',
    ],
    watch: 'Rushing. The range is small, so speed removes almost all the work.',
  },
  {
    id: 'leg-press',
    match: /leg press/,
    setup: 'Sit with your whole back on the pad and your feet mid-plate about shoulder-width, toes slightly out.',
    steps: [
      'Unlock the sled and lower until your knees reach about 90°, or as far as you can go without the hips curling off the seat.',
      'Push through the whole foot to press it back up.',
      'Stop just short of locking the knees.',
    ],
    watch: 'The lower back rounding off the pad at the bottom. That, not depth, is the limit of your range.',
  },
  {
    id: 'leg-extension',
    match: /leg extension/,
    setup: 'Set the seat so your knees line up with the machine\'s pivot and the pad sits on your shins, not your feet.',
    steps: [
      'Straighten the knees until the legs are fully extended.',
      'Squeeze the quads at the top for a beat.',
      'Lower slowly to just short of where the stack touches down.',
    ],
    watch: 'Kicking to full extension and dropping back. The lowering half is most of the exercise.',
  },
  {
    id: 'leg-curl',
    match: /leg curl/,
    setup: 'Set the pad just above your heels with your knees at the machine\'s pivot.',
    setupWhen: [
      [/bodyweight|on ball/, 'Lie on your back with your heels on the ball (or a slider) and your hips lifted.'],
    ],
    steps: [
      'Curl your heels toward your glutes as far as they will go.',
      'Squeeze at the top, keeping your hips pressed down.',
      'Lower slowly all the way to straight.',
    ],
    watch: 'The hips lifting off the pad to help. If they rise, the weight is doing the choosing.',
  },
  {
    id: 'pistol',
    match: /pistol/,
    setup: 'Stand on one leg with the other extended in front of you and your arms out for balance.',
    steps: [
      'Push the hips back and sit down slowly on the working leg, keeping the free leg off the floor.',
      'Go as deep as you can control, ideally until the hamstring meets the calf.',
      'Drive through the whole foot to stand back up.',
    ],
    watch: 'The knee caving inward as you come up. Hold a counterweight or use a box to shorten the range until it tracks straight.',
  },
  {
    id: 'cossack',
    match: /cossack/,
    setup: 'Take a very wide stance with your toes pointing slightly out.',
    steps: [
      'Shift your weight onto one leg and sit down into it, letting the other leg straighten with the toes up.',
      'Keep the chest tall and both heels down.',
      'Push back to the centre, then repeat on the other side.',
    ],
    watch: 'The heel of the bent leg lifting. Sit back rather than forward, and elevate the straight leg\'s heel if your ankles need it.',
  },
  {
    id: 'lateral-lunge',
    match: /side lunge/,
    setup: 'Stand tall with your feet together and room to step out sideways.',
    steps: [
      'Step wide to one side and sit into that hip, keeping the trailing leg straight.',
      'Keep both feet flat and the chest up.',
      'Push off the bent leg to return to the start.',
    ],
    watch: 'Letting the knee travel past the toes of the stepping leg. Sit back into the hip instead.',
  },
  {
    id: 'split-squat',
    match: /split squat|bulgarian/,
    setup: 'Put the top of your rear foot on a bench behind you and step the front foot out far enough that the shin stays near-vertical at the bottom.',
    steps: [
      'Lower straight down until the back knee is just off the floor.',
      'Keep your weight in the front heel and the torso slightly forward.',
      'Drive up through the front foot without pushing off the back one.',
    ],
    watch: 'Standing too close to the bench, which crushes the front knee. Step further out and it becomes a hip exercise.',
  },
  {
    id: 'step-up',
    match: /step[- ]?up/,
    setup: 'Stand facing a box at about knee height with the weight held at your sides or in the front rack.',
    steps: [
      'Plant the whole of one foot on the box.',
      'Drive through that heel to stand up on the box — the trailing leg should not push off the floor.',
      'Lower back down slowly under control with the same leg.',
    ],
    watch: 'Bouncing off the back foot. If you cannot do it without, lower the box.',
  },
  {
    id: 'lunge',
    match: /lunge/,
    setup: 'Stand tall with the weight at your sides, feet hip-width.',
    setupWhen: [
      [/reverse/, 'Stand tall with the weight at your sides and space to step backwards.'],
      [/curtsy/, 'Stand tall with the weight at your sides, ready to step one leg back and across behind the other.'],
    ],
    steps: [
      'Take a long step and lower straight down until both knees are near 90°.',
      'Keep the torso upright and the front shin close to vertical.',
      'Drive through the front heel to return to the start.',
    ],
    watch: 'A short step, which puts the whole load on the front knee. Longer step, more glute and hamstring.',
  },
  {
    // Not a squat. The barbell version is a deadlift with the bar BEHIND the
    // legs — nothing rests on your back — so it cannot share the squat entry
    // even though the machine version can.
    id: 'barbell-hack-squat',
    match: /barbell hack squat/,
    setup: 'Stand in front of the bar with it just behind your heels, feet hip-width.',
    steps: [
      'Squat down and take an overhand grip on the bar behind you, arms straight.',
      'Keep your chest up and push the floor away, dragging the bar up the backs of your legs.',
      'Stand tall, then lower it back down the same path under control.',
    ],
    watch: 'Letting the bar swing away from your legs, which pulls you backwards. Keep it in contact the whole way.',
  },
  {
    id: 'squat',
    match: /squat/,
    setup: 'Set the bar on your upper back, step out to a shoulder-width stance with your toes slightly out.',
    setupBy: {
      dumbbell: 'Hold the weight at your chest or by your sides and stand shoulder-width with your toes slightly out.',
      kettlebell: 'Hold the bell at your chest with both hands, elbows tucked in, feet shoulder-width.',
      bodyweight: 'Stand shoulder-width with your toes slightly out and your arms free in front of you for balance.',
      machine: 'Set the pads on your shoulders, step your feet out in front of you and take the weight off the supports.',
      smith: 'Set the bar on your upper back and walk your feet slightly forward of it so the fixed path suits your squat.',
    },
    // Most of the catalog's squats classify as `barbell` (the equipment regex
    // keys on the word "squat"), so the implement map catches almost none of
    // them and the real work happens here. A goblet squat handed "set the bar
    // on your upper back" is the exact failure this file exists to avoid.
    setupWhen: [
      [/goblet/, 'Hold a single bell or dumbbell against your chest with both hands, elbows tucked in, feet shoulder-width.'],
      [/zombie/, 'Rest the bar on the front of your shoulders and hold both arms straight out in front of you — no hands on the bar.'],
      [/front squat/, 'Rack the weight across the front of your shoulders with the elbows driven high, feet shoulder-width.'],
      [/zercher/, 'Hold the bar in the crooks of your elbows against your body, feet shoulder-width.'],
      [/hack squat machine|landmine hack squat|pendulum/, 'Set your shoulders and back against the pads and place your feet mid-platform, slightly forward of your hips.'],
      [/belt squat/, 'Hook the belt around your hips, stand on the platform and let the weight hang between your legs.'],
      [/landmine squat/, 'Hold the end of the bar at your chest with both hands, feet shoulder-width, and let it arc as you descend.'],
      [/sumo/, 'Take a wide stance with your toes turned out, weight held between your legs or on your back.'],
      [/box squat|chair/, 'Set a box behind you at about knee height and take your usual squat stance in front of it.'],
    ],
    steps: [
      'Take a big breath, brace your midsection and push your hips back as the knees bend.',
      'Sit down between your feet until your hips pass below your knees, or as deep as you can hold a flat back.',
      'Keep your knees tracking over your toes and your chest up.',
      'Drive up through the whole foot, hips and chest rising together.',
    ],
    watch: 'The hips shooting up ahead of the chest out of the bottom, which turns it into a good morning. Slow the descent and drive the chest up first.',
  },

  // ── Shoulders ────────────────────────────────────────────────────────────
  {
    id: 'rear-delt',
    match: /rear delt|reverse (cable|dumbbell|machine) fl|face pull|pull-apart/,
    setup: 'Set up with the resistance at about face height and your arms out in front of you.',
    setupWhen: [
      [/rear delt row|reverse dumbbell fl/, 'Hinge forward at the hips with a flat back so your arms hang straight down.'],
      [/incline bench/, 'Lie chest-down on an incline bench with your arms hanging straight down.'],
      [/pull-apart/, 'Stand tall holding a band at shoulder height with straight arms, hands shoulder-width.'],
    ],
    steps: [
      'Lead with the elbows and pull out and back, keeping the upper arms roughly at shoulder height.',
      'Finish with your shoulder blades squeezed together and your hands wider than your elbows.',
      'Return slowly and let the shoulder blades travel forward at the end of each rep.',
    ],
    watch: 'Shrugging. If you feel it in your traps, drop the weight and think about pulling your elbows apart, not up.',
  },
  {
    id: 'shoulder-rotation',
    match: /shoulder rotation/,
    setup: 'Tuck the working elbow into your side at 90° — a rolled towel between elbow and ribs helps keep it there.',
    setupWhen: [
      [/lying/, 'Lie on your side with the working arm on top, elbow tucked into your ribs at 90°.'],
    ],
    steps: [
      'Rotate the forearm out (or in) while the elbow stays glued in place.',
      'Go only as far as the rotation allows — usually less range than you expect.',
      'Return slowly. Use the lightest resistance available.',
    ],
    watch: 'The elbow drifting away from the ribs, which lets the bigger muscles take over from the ones you are trying to train.',
  },
  {
    id: 'cuban-press',
    match: /cuban press/,
    setup: 'Stand tall holding a light bar or bells at thigh height, palms facing you.',
    steps: [
      'Pull the weight up into a high row until your upper arms are at shoulder height.',
      'Keeping the elbows there, rotate the forearms up until they point at the ceiling.',
      'Press overhead, then reverse all three parts in order.',
    ],
    watch: 'Loading it. Three joints in sequence at the end of the shoulder\'s range means very light weight.',
  },
  {
    id: 'upright-row',
    match: /upright row|monkey row/,
    setup: 'Stand tall holding the weight in front of your thighs, hands about shoulder-width — not narrow.',
    steps: [
      'Pull the weight up by driving the elbows out and up.',
      'Stop when your upper arms reach shoulder height; no higher.',
      'Lower slowly to straight arms.',
    ],
    watch: 'A narrow grip and pulling to the chin. Both jam the shoulder — stay wide and stop at shoulder height.',
  },
  {
    id: 'shrug',
    match: /shrug/,
    setup: 'Stand tall holding the weight at arm\'s length, arms straight, shoulders relaxed.',
    steps: [
      'Lift the shoulders straight up toward your ears as high as they go.',
      'Hold the top for a full second.',
      'Lower all the way down into a stretch.',
    ],
    watch: 'Rolling the shoulders. Traps lift, they do not circle — and the roll does nothing but grind the joint.',
  },
  {
    id: 'lateral-raise',
    match: /lateral raise|poliquin raise/,
    setup: 'Stand tall with the weight at your sides, a slight bend in the elbows, and a slight forward lean at the hips.',
    steps: [
      'Raise the arms out to the sides, leading with the elbows.',
      'Stop at shoulder height with the weight roughly level with your hands.',
      'Lower slowly — take twice as long coming down as going up.',
    ],
    watch: 'Swinging the weight up with the hips. If it needs momentum to start, it is too heavy for a side delt.',
  },
  {
    id: 'front-raise',
    match: /front raise/,
    setup: 'Stand tall with the weight in front of your thighs, arms straight, core braced.',
    steps: [
      'Raise the weight straight out in front of you with the arms almost locked.',
      'Stop at shoulder height, or slightly above.',
      'Lower under control without letting it swing back into your legs.',
    ],
    watch: 'Leaning back as you lift. Squeeze the glutes and keep the ribs down so the shoulder does the work.',
  },
  {
    id: 'front-hold',
    match: /front hold/,
    setup: 'Hold a plate at arm\'s length in front of you at shoulder height, arms straight.',
    steps: [
      'Brace the midsection and keep the ribs down.',
      'Hold the position for time, with no leaning back.',
      'Lower it under control when the position starts to break, not after.',
    ],
    watch: 'Arching the lower back as the shoulders fatigue. That is the end of the set.',
  },
  {
    id: 'behind-neck-press',
    match: /behind the neck press/,
    setup: 'Rack the bar on your upper back with a wide grip, standing or seated with your torso upright.',
    steps: [
      'Press straight up, keeping the bar in line with the back of your head.',
      'Lock out overhead with the shoulder blades rotating up.',
      'Lower only as far as your shoulder mobility genuinely allows — usually ear height, not the neck.',
    ],
    watch: 'Forcing depth. This position demands real overhead mobility; if it pinches, press from the front instead.',
  },
  {
    id: 'landmine-press',
    match: /landmine press/,
    setup: 'Hold the end of the bar at shoulder height with the other end wedged in a corner or landmine sleeve.',
    steps: [
      'Press up and forward along the bar\'s natural arc, not straight up.',
      'Finish with the arm extended and the shoulder blade travelling forward around your ribs.',
      'Return to the shoulder under control.',
    ],
    watch: 'Fighting the arc. The angle is the whole point — it lets you press hard without a full overhead position.',
  },
  {
    id: 'overhead-press',
    match: /overhead press|shoulder press|arnold press|kettlebell press|z press/,
    setup: 'Hold the weight at shoulder height with your elbows slightly in front of it, feet hip-width, glutes and abs tight.',
    setupBy: {
      machine: 'Set the seat so the handles start at about shoulder height, back flat against the pad.',
      smith: 'Set the bar at shoulder height and sit or stand so it travels just in front of your face.',
    },
    setupWhen: [
      [/z press/, 'Sit on the floor with your legs straight out in front of you and the weight at shoulder height.'],
      [/seated/, 'Sit with your back against the pad and the weight at shoulder height, feet planted.'],
      [/arnold/, 'Sit or stand holding the bells at chest height with your palms facing you.'],
    ],
    steps: [
      'Squeeze your glutes and brace so your lower back cannot arch.',
      'Press straight up, moving your head back slightly to let the weight pass, then forward under it.',
      'Lock out with the weight over the middle of your feet and your biceps by your ears.',
      'Lower back to your shoulders under control.',
    ],
    watch: 'Leaning back to press. If the ribs flare, you have turned it into a standing incline press — brace harder and lighten it.',
  },

  // ── Chest and triceps ────────────────────────────────────────────────────
  {
    id: 'bench-dip',
    // `Tricep Dips` is not in the catalog but IS a drawn pose, and the figure
    // draws it off a bench seat — so it belongs here, not on the parallel bars.
    match: /bench dip|tricep dips?/,
    setup: 'Sit on the edge of a bench, hands beside your hips, and slide your weight forward off the bench with your legs out.',
    steps: [
      'Lower by bending the elbows straight back until your upper arms reach about parallel.',
      'Keep your back close to the bench the whole way down.',
      'Press back up to a full lockout.',
    ],
    watch: 'Drifting away from the bench, which rolls the shoulders forward at the bottom. Stay close and stop at parallel.',
  },
  {
    id: 'dip',
    match: /\bdips?\b/,
    setup: 'Take the bars and press up to a full lockout with your arms straight, ankles crossed behind you.',
    setupWhen: [
      [/assisted/, 'Set the assistance and kneel or stand on the pad, then press up to a full lockout with straight arms.'],
    ],
    steps: [
      'Lean your torso forward slightly and lower by bending the elbows.',
      'Go until your upper arms are about parallel to the floor, or wherever the shoulder stays comfortable.',
      'Press back up to straight arms.',
    ],
    watch: 'Sinking below what your shoulders can hold. Depth here is earned — stop at parallel until it is easy.',
  },
  {
    id: 'push-up',
    match: /push[- ]?ups?\b/,
    setup: 'Set your hands under your shoulders, slightly wider than your ribs, with your body in one line from ears to heels.',
    setupWhen: [
      [/against wall/, 'Stand an arm\'s length from a wall with your hands on it at chest height and your body in one straight line.'],
      [/kneeling/, 'Set your hands under your shoulders and your knees on the floor, with a straight line from ears to knees.'],
      [/incline/, 'Put your hands on a bench or box, walk your feet back and hold one line from ears to heels.'],
      [/decline|feet in rings/, 'Put your feet on a bench or in the rings and your hands under your shoulders on the floor.'],
      [/close-grip/, 'Set your hands directly under your shoulders, no wider, body in one line from ears to heels.'],
      [/plank to/, 'Start on your elbows in a plank position, body in one line from ears to heels.'],
      [/cobra/, 'Lie face down with your hands under your shoulders and your legs and hips relaxed on the floor.'],
    ],
    stepsWhen: [
      [/plank to/, [
        'Press up onto one hand, then the other, into a push-up position without letting your hips twist.',
        'Lower back onto one elbow, then the other, in the same order.',
        'Alternate which arm leads each rep so both sides get the same work.',
      ]],
      [/cobra/, [
        'Press your chest and shoulders up while your hips stay on the floor, straightening the arms.',
        'Open the chest and look slightly up at the top — this is a back extension, not a chest press.',
        'Lower yourself all the way back down under control.',
      ], 'Pushing into the range with your arms. Let the back do the extending and stop where it is comfortable.'],
      [/clap/, [
        'Lower until your chest is an inch off the floor, elbows about 45° from your ribs.',
        'Press up as explosively as you can so your hands leave the floor.',
        'Clap, then catch yourself with soft elbows and absorb straight into the next rep.',
      ], 'Landing on locked arms. Catch soft, and stop the set the moment you cannot get the hands off the floor cleanly.'],
    ],
    steps: [
      'Squeeze the glutes so the hips cannot sag, and take a breath.',
      'Lower until your chest is an inch off the floor, elbows about 45° from your ribs.',
      'Press back up to straight arms and let the shoulder blades spread apart at the top.',
    ],
    watch: 'Hips sagging or head poking forward. If the line breaks before the reps run out, raise your hands and do them on an incline.',
  },
  {
    id: 'skull-crusher',
    match: /skull crusher|lying triceps extension|tate press/,
    setup: 'Lie on a flat bench holding the bar or bells over your chest with straight arms.',
    steps: [
      'Keeping the upper arms still, bend the elbows and lower the weight toward your forehead or just behind it.',
      'Stop where the triceps are fully stretched but the elbows are pain-free.',
      'Extend back to straight arms without letting the upper arms drift.',
    ],
    watch: 'Turning it into a press by letting the elbows travel back. Only the forearms should move.',
  },
  {
    id: 'pushdown',
    match: /pushdown/,
    setup: 'Stand facing a high pulley, elbows pinned to your sides, forearms up at about 90°.',
    steps: [
      'Push down by straightening the elbows only.',
      'Lock out and squeeze the triceps for a beat at the bottom.',
      'Let it come back to 90° without the elbows lifting.',
    ],
    watch: 'Leaning over the bar to add bodyweight. Stand tall, keep the elbows fixed, and take weight off the stack.',
  },
  {
    id: 'triceps-extension',
    match: /triceps extension|tricep bodyweight extension/,
    setup: 'Set the weight behind your head with your elbows pointing forward and close together.',
    setupWhen: [
      [/bodyweight/, 'Set a bar at hip height, take a shoulder-width grip and lean forward onto straight arms.'],
      [/crossbody/, 'Stand side-on to a low pulley and hold the handle across your body with the elbow high.'],
    ],
    steps: [
      'Keeping the upper arms still and the elbows pointing forward, lower the weight behind your head into a stretch.',
      'Extend back to a full lockout without letting the elbows flare out.',
      'Squeeze the triceps at the top for a beat.',
    ],
    watch: 'The elbows flaring wide, which shortens the range and hands the work to the shoulders.',
  },
  {
    id: 'curl',
    match: /curl/,
    setup: 'Stand tall holding the weight at arm\'s length, elbows pinned to your sides.',
    setupWhen: [
      [/preacher|spider/, 'Set your upper arms flat on the pad so they cannot move, and take the weight at arm\'s length.'],
      [/incline/, 'Sit back on an incline bench and let your arms hang straight down behind your torso.'],
      [/concentration/, 'Sit on a bench and brace your working elbow against the inside of your thigh.'],
      [/lying|bayesian/, 'Set up so the resistance pulls your arm behind your body, keeping the upper arm still.'],
      [/overhead cable/, 'Stand between two pulleys set above head height and take a handle in each hand, arms out at shoulder height.'],
      [/reverse/, 'Stand tall holding the weight at arm\'s length with an OVERHAND grip, elbows pinned to your sides.'],
      [/bodyweight/, 'Set a bar at about waist height, take an underhand grip and lean back with your arms straight.'],
    ],
    setupBy: {
      machine: 'Set the seat so your upper arms rest flat on the pad and take the handles at arm\'s length.',
    },
    stepsWhen: [
      [/drag/, [
        'Curl the weight up by dragging it straight up your body, letting the elbows travel BACK behind you.',
        'Stop when it reaches your lower chest — the range is short by design.',
        'Lower it back down the same path, staying in contact with your body.',
      ]],
      [/zottman/, [
        'Curl the weight up with your palms up, keeping the upper arms still.',
        'At the top, rotate your wrists so the palms face down.',
        'Lower slowly in that overhand position, then rotate back to palms-up at the bottom.',
      ]],
    ],
    steps: [
      'Curl the weight up by bending the elbows, keeping the upper arms still.',
      'Squeeze at the top where the biceps are shortest.',
      'Lower all the way to straight arms — slower than you lifted.',
    ],
    watch: 'Swinging the hips and letting the elbows drift forward. If your body moves, the biceps just got a rest.',
  },
  {
    id: 'fly',
    match: /\bfly|flyes|pec deck|crossover/,
    setup: 'Lie back with a bell in each hand pressed over your chest, elbows slightly bent and then locked at that angle.',
    setupBy: {
      cable: 'Set the pulleys high or at chest height, take a handle in each hand and step forward into a split stance.',
      machine: 'Set the seat so the handles are level with your chest and your back is flat against the pad.',
      band: 'Anchor the band behind you at chest height, take an end in each hand and step forward into the tension.',
    },
    steps: [
      'Open your arms wide and let the chest stretch, keeping that same slight elbow bend throughout.',
      'Stop where the stretch is strong but comfortable.',
      'Hug the weights back together as if wrapping your arms around a barrel, and squeeze at the top.',
    ],
    watch: 'Bending the elbows on the way up, which turns it into a clumsy press. The elbow angle is fixed for the whole rep.',
  },
  {
    id: 'pullover',
    match: /pullover/,
    setup: 'Lie on a bench holding one bell over your chest with both hands, arms nearly straight.',
    steps: [
      'Keeping that arm angle, take the weight back over your head until you feel a strong stretch through the lats and ribs.',
      'Keep your ribs down — do not let the lower back arch to buy range.',
      'Pull it back over your chest with the lats.',
    ],
    watch: 'Arching the lower back to reach further. The range comes from the shoulders, not the spine.',
  },
  {
    id: 'incline-press',
    match: /incline (bench|dumbbell|chest)? ?press|incline press/,
    setup: 'Set the bench to about 30°, plant your feet, and pin your shoulder blades down and back into the pad.',
    steps: [
      'Take the weight to arm\'s length over your upper chest.',
      'Lower to the top of the chest, just under the collarbone, with the elbows about 45° from your ribs.',
      'Press back up and slightly back, finishing over your shoulders.',
    ],
    watch: 'Setting the bench too steep. Past about 45° it becomes a shoulder press with a worse angle for the chest.',
  },
  {
    id: 'decline-press',
    match: /decline (bench|chest)? ?press/,
    setup: 'Hook your legs in on the decline bench, lie back and pin the shoulder blades down and back.',
    steps: [
      'Take the weight to arm\'s length over your lower chest.',
      'Lower to the lower chest with the elbows tucked to about 45°.',
      'Press back up to straight arms.',
    ],
    watch: 'Sitting up too fast at the end of the set. Rack it first, then unhook — blood pressure does odd things upside down.',
  },
  {
    id: 'floor-press',
    match: /floor press/,
    setup: 'Lie on the floor with your knees bent and the weight at arm\'s length over your chest.',
    steps: [
      'Lower until the backs of your upper arms touch the floor.',
      'Pause there for a beat — the floor sets the range, so use it.',
      'Press back up to straight arms.',
    ],
    watch: 'Bouncing the elbows off the floor. Touch, pause, then press.',
  },
  {
    id: 'bench-press',
    match: /bench press|board press|\bpin press\b/,
    setup: 'Lie back with your eyes under the bar, feet planted, and pull your shoulder blades down and back into the bench.',
    setupBy: {
      smith: 'Set the bar height so you can unrack with a small press, lie back and pin the shoulder blades down and back.',
    },
    setupWhen: [
      [/feet-up/, 'Lie back with your feet up on the bench or in the air, and pin the shoulder blades down and back.'],
      [/close-grip/, 'Lie back and take a grip about shoulder-width, hands inside your normal bench position.'],
    ],
    steps: [
      'Unrack and hold the bar over your shoulders with straight arms.',
      'Lower it to your mid-chest with the elbows about 45° from your ribs — not flared straight out.',
      'Touch the chest without bouncing, then press up and slightly back toward the rack.',
      'Keep your feet, hips and shoulder blades in contact throughout.',
    ],
    watch: 'Flaring the elbows out to 90°. It feels stronger for a rep or two and it is the fastest way to an angry shoulder.',
  },
  {
    id: 'chest-press',
    match: /chest press/,
    setup: 'Lie back with a bell in each hand at chest height and your shoulder blades pinned down and back.',
    setupBy: {
      machine: 'Set the seat so the handles are level with the middle of your chest, back flat against the pad.',
      cable: 'Set both pulleys at chest height, take a handle in each hand and step forward into a split stance.',
    },
    steps: [
      'Press the weight to arm\'s length over your chest.',
      'Lower until you feel a stretch across the chest, elbows about 45° from your ribs.',
      'Press back up, bringing the hands slightly together at the top.',
    ],
    watch: 'Letting the shoulders roll forward at the bottom. Keep the blades pinned back and shorten the range if you must.',
  },

  // ── Back ─────────────────────────────────────────────────────────────────
  {
    id: 'straight-arm-pulldown',
    match: /straight arm lat pulldown|rope pulldown/,
    setup: 'Stand facing a high pulley, hinge slightly forward and take the bar or rope with straight arms overhead.',
    steps: [
      'Keeping the elbows locked, pull the handle down in an arc to your thighs.',
      'Squeeze the lats at the bottom for a beat.',
      'Let it travel back overhead until you feel the lats stretch.',
    ],
    watch: 'Bending the elbows, which turns it into a pushdown. Arms stay straight the whole way.',
  },
  {
    id: 'pulldown',
    match: /pulldown/,
    setup: 'Set the thigh pad so you cannot lift off the seat, and take the bar with your chosen grip and straight arms.',
    steps: [
      'Lean back very slightly and pull your shoulder blades down before the elbows bend.',
      'Pull the bar to your collarbone, driving the elbows down toward your ribs.',
      'Let it rise all the way back up until the lats are stretched and the shoulders travel up.',
    ],
    watch: 'Leaning back into a row to move a heavier stack. Keep the torso near-vertical and pull down, not back.',
  },
  {
    id: 'scap-pull-up',
    match: /scap pull-?up/,
    setup: 'Hang from the bar with straight arms and your shoulders relaxed up toward your ears.',
    steps: [
      'Without bending the elbows, pull your shoulder blades down and back so your body rises an inch or two.',
      'Hold that top position for a beat.',
      'Let the shoulders relax back up into the hang.',
    ],
    watch: 'Bending the arms. The range is tiny by design — this trains the part of a pull-up most people skip.',
  },
  {
    id: 'pull-up',
    match: /pull-?up|chin-?up|chest to bar/,
    setup: 'Take the bar with your chosen grip, a little wider than your shoulders, and hang with straight arms.',
    setupWhen: [
      [/assisted/, 'Set the assistance, take your grip and put a knee or foot on the pad, then hang with straight arms.'],
    ],
    steps: [
      'Pull the shoulder blades down first, then drive the elbows toward your ribs.',
      'Pull until your chin clears the bar, keeping the ribs down rather than kicking.',
      'Lower all the way to straight arms under control.',
    ],
    watch: 'Half reps at the bottom. Full hang to chin over the bar, or use assistance until that range is yours.',
  },
  {
    id: 'muscle-up',
    match: /muscle-?up/,
    setup: 'Take a firm grip on the bar or rings and hang with straight arms.',
    steps: [
      'Pull explosively, leaning back so the bar travels toward your hips rather than your chin.',
      'As it reaches your chest, whip the elbows around and forward to get above it.',
      'Press out of the bottom of the dip to a full lockout.',
    ],
    watch: 'Trying to muscle the transition. It needs a pull to at least sternum height first — build that before chasing the turnover.',
  },
  {
    id: 'inverted-row',
    match: /inverted row|ring row|towel row/,
    setup: 'Set a bar or rings at about hip height, lie underneath and take an overhand grip a little wider than your shoulders.',
    steps: [
      'Hang with straight arms and your body in one line from ears to heels, heels on the floor.',
      'Pull your chest to the bar by driving the elbows back and squeezing the shoulder blades.',
      'Lower all the way to straight arms without letting the hips drop.',
    ],
    watch: 'Hips sagging as you tire. Raise the bar to make it easier rather than breaking the line.',
  },
  {
    id: 'renegade-row',
    match: /renegade row/,
    setup: 'Set up in a push-up position with a hand on each dumbbell, feet wide for stability.',
    steps: [
      'Brace hard and shift your weight onto one arm.',
      'Row the other bell to your ribs without letting your hips rotate.',
      'Put it down under control and repeat on the other side.',
    ],
    watch: 'Hips twisting toward the rowing side. Widen your feet, lighten the bells, and keep the hips level.',
  },
  {
    id: 'seated-row',
    match: /seated row|seated machine row|cable .*\brow\b|one-handed cable row/,
    setup: 'Sit tall with a slight knee bend, chest against the pad if there is one, arms extended.',
    steps: [
      'Let the shoulder blades travel forward at the start of each rep for a full stretch.',
      'Pull the handle to your stomach by driving the elbows back and squeezing the blades together.',
      'Return slowly to a full stretch without leaning forward from the lower back.',
    ],
    watch: 'Rowing with the torso — rocking back and forth. Lock the trunk and let the arms and back travel.',
  },
  {
    id: 'row',
    match: /\brow\b/,
    setup: 'Hinge forward at the hips with a flat back until your torso is 15–45° above parallel, weight hanging at arm\'s length.',
    setupWhen: [
      [/chest[- ]supported|seal/, 'Lie chest-down on the bench with the weight hanging straight below you.'],
      [/gorilla|kroc/, 'Hinge forward with one hand braced (or holding a bench) and the weight hanging at arm\'s length.'],
      [/t-bar/, 'Straddle the bar, take the handles and hinge forward with a flat back and your chest up.'],
    ],
    steps: [
      'Let the weight hang and the shoulder blades travel forward.',
      'Pull to your stomach or lower ribs by driving the elbows back — the bar or bell touches, it does not stop short.',
      'Squeeze the shoulder blades together at the top for a beat.',
      'Lower all the way back to a full stretch.',
    ],
    watch: 'Standing up as you pull. If your torso angle changes mid-rep, the weight is too heavy for your back position.',
  },

  // ── Core ─────────────────────────────────────────────────────────────────
  {
    id: 'plank',
    match: /plank/,
    setup: 'Set your elbows under your shoulders and your feet hip-width, body in one line from ears to heels.',
    setupWhen: [
      [/side plank/, 'Lie on your side, elbow under your shoulder, feet stacked or staggered, and lift your hips into one straight line.'],
      [/copenhagen/, 'Lie on your side with your top leg on a bench and your elbow under your shoulder, then lift your hips.'],
      [/kneeling/, 'Set your elbows under your shoulders and your knees on the floor, in one line from ears to knees.'],
      [/pull through/, 'Set up in a push-up position with a bell just outside one hand and your feet wide.'],
    ],
    stepsWhen: [
      [/pull through/, [
        'Brace hard so your hips cannot rotate — that is the entire exercise.',
        'Reach under your body with the free hand and drag the bell across to the other side.',
        'Reset your hand and repeat in the other direction, keeping the hips square throughout.',
      ]],
    ],
    steps: [
      'Squeeze your glutes and tuck your hips slightly so the lower back flattens.',
      'Pull your elbows toward your toes without moving them — that is what makes it hard.',
      'Breathe normally and hold. End the set when the position breaks, not when the timer says so.',
    ],
    watch: 'Sagging hips and a lifted head. Both mean the abs have stopped working — reset or stop.',
  },
  {
    id: 'hollow',
    match: /hollow/,
    setup: 'Lie on your back and press your lower back flat into the floor.',
    steps: [
      'Lift your shoulder blades and your legs off the floor, arms overhead or by your sides.',
      'Keep the lower back pressed down — that contact is the whole exercise.',
      'Hold, and lower your legs a little higher if the back starts to lift.',
    ],
    watch: 'A gap under the lower back. Bend the knees or raise the legs until it is flat again.',
  },
  {
    id: 'l-sit',
    match: /l-sit/,
    setup: 'Sit between parallettes, blocks or on the floor with your hands beside your hips.',
    steps: [
      'Press down hard and lift your hips off the floor with the shoulders pushed away from your ears.',
      'Lift the legs to straight and parallel with the floor.',
      'Hold, breathing, and come down before the shape collapses.',
    ],
    watch: 'Rounding the back to hoist the legs. Tuck the knees instead and build up to straight legs.',
  },
  {
    id: 'dragon-flag',
    match: /dragon flag/,
    setup: 'Lie on a bench and grip it firmly behind your head with your shoulders as the only contact point.',
    steps: [
      'Lift your whole body up so it is nearly vertical, supported on the upper back.',
      'Lower it as one rigid line, as slowly as you can — no bending at the hips.',
      'Stop before you touch the bench and go again, or reset.',
    ],
    watch: 'Piking at the hips. If the line breaks, bend your knees to shorten the lever until it doesn\'t.',
  },
  {
    id: 'dead-bug',
    match: /dead bug/,
    setup: 'Lie on your back with your arms straight up and your knees over your hips at 90°.',
    steps: [
      'Press your lower back into the floor and keep it there for every rep.',
      'Slowly lower one arm overhead and the opposite leg toward the floor.',
      'Go only as far as you can without the back lifting, then return and switch sides.',
    ],
    watch: 'The lower back arching off the floor as the limbs extend. That is the exact point your range ends.',
  },
  {
    id: 'ab-wheel',
    match: /ab wheel/,
    setup: 'Kneel with the wheel under your shoulders and your hips tucked slightly under.',
    steps: [
      'Roll out slowly, keeping the hips tucked and the lower back flat.',
      'Go as far as you can without the back arching — for most people that is well short of full extension.',
      'Pull back with the abs, not by pushing with the arms.',
    ],
    watch: 'Rolling out past your control and dropping into an arch. Shorten the range; it should feel like a moving plank.',
  },
  {
    id: 'windshield',
    match: /windshield/,
    setup: 'Lie on your back (or hang from a bar) with your legs lifted and together.',
    steps: [
      'Keeping the shoulders pinned, rotate the legs to one side under control.',
      'Stop before your shoulder lifts, then bring them back through the middle.',
      'Rotate to the other side with the same control.',
    ],
    watch: 'Letting gravity swing the legs down. Slow, controlled travel or bend the knees to shorten the lever.',
  },
  {
    id: 'wood-chop',
    match: /wood chop/,
    setup: 'Stand side-on to the anchor in an athletic stance and take the handle with both hands.',
    steps: [
      'Pull and rotate across your body in a diagonal line, pivoting the back foot as you go.',
      'Keep the arms fairly straight — the rotation comes from the hips and trunk.',
      'Return slowly along the same path, resisting the pull back.',
    ],
    watch: 'Rotating from the lower back with the feet stuck. Let the back heel pivot and the hips turn.',
  },
  {
    id: 'pallof',
    match: /pallof/,
    setup: 'Stand side-on to a cable or band set at chest height, holding the handle at your chest with both hands.',
    steps: [
      'Step out to load the band, feet shoulder-width, hips square.',
      'Press the handle straight out in front of your chest and hold — the resistance will try to turn you.',
      'Resist that turn, then bring it back to your chest.',
    ],
    watch: 'Letting the torso rotate toward the anchor. Move closer to it, lighten the load and keep the shoulders square.',
  },
  {
    id: 'rotation',
    match: /landmine rotation|core twist|russian twist/,
    setup: 'Take an athletic stance (or sit leaning back) holding the weight in front of your chest.',
    steps: [
      'Rotate to one side under control, letting the hips follow the shoulders.',
      'Pause briefly at the end of the range.',
      'Rotate through to the other side without dumping the weight at the bottom.',
    ],
    watch: 'Whipping side to side. Speed here gets you range from the lower back rather than work in the obliques.',
  },
  {
    id: 'side-bend',
    match: /side bend/,
    setup: 'Stand tall with a weight in one hand only, feet hip-width, other hand on your head or hip.',
    steps: [
      'Bend sideways toward the weighted side, letting it slide down your thigh.',
      'Come back up and continue slightly past vertical to the other side.',
      'Complete all the reps before switching hands.',
    ],
    watch: 'Twisting as you bend. It is a straight side-to-side movement in one plane.',
  },
  {
    id: 'hanging-raise',
    match: /hanging (knee|leg) raise|hanging sit-?up|captain'?s chair/,
    setup: 'Hang from the bar (or settle into the chair pads) with your shoulders active and your body still.',
    steps: [
      'Tilt your pelvis back first so the movement starts from the abs, not the hip flexors.',
      'Lift the knees (or straight legs) to at least hip height without swinging.',
      'Lower slowly and stop the swing before the next rep.',
    ],
    watch: 'Kipping. If your body swings, the abs are along for the ride — bend the knees and slow down.',
  },
  {
    id: 'leg-raise',
    match: /leg raise/,
    setup: 'Lie flat with your hands under your hips or beside you and your legs straight.',
    steps: [
      'Press your lower back into the floor and keep it there.',
      'Lift the legs to vertical, keeping them straight.',
      'Lower slowly, stopping the moment the lower back starts to lift.',
    ],
    watch: 'The lower back arching off the floor near the bottom. That is the end of your range, not a rep to push through.',
  },
  {
    id: 'cable-crunch',
    match: /cable crunch|machine crunch/,
    setup: 'Kneel below a high pulley (or sit in the machine) and take the handles beside your head.',
    steps: [
      'Keeping the hips fixed, crunch by pulling your ribs toward your pelvis and rounding the upper back.',
      'Squeeze hard at the bottom of the range.',
      'Return slowly, resisting the stretch at the top.',
    ],
    watch: 'Hinging at the hips instead of curling the spine. The hips do not move at all here.',
  },
  {
    id: 'oblique-crunch',
    match: /oblique|bicycle crunch/,
    setup: 'Lie on your back with your hands lightly behind your head, elbows wide.',
    steps: [
      'Lift your shoulder blades off the floor and rotate one shoulder toward the opposite knee.',
      'Squeeze at the top of the rotation.',
      'Lower under control and alternate sides.',
    ],
    watch: 'Pulling on your neck. The hands rest there; the abs do the lifting.',
  },
  {
    id: 'sit-up',
    match: /sit-?up/,
    setup: 'Lie on your back with your knees bent and your feet flat (anchored if you like).',
    steps: [
      'Curl up one segment at a time, chin tucked, until your torso is upright.',
      'Keep the movement smooth rather than yanking off the floor.',
      'Lower back down with the same control, one segment at a time.',
    ],
    watch: 'Throwing the arms to get up. If you need them, do crunches until the strength is there.',
  },
  {
    id: 'crunch',
    match: /crunch/,
    setup: 'Lie on your back with your knees bent and your hands crossed on your chest or lightly behind your head.',
    steps: [
      'Curl your ribs toward your pelvis, lifting the shoulder blades a few inches off the floor.',
      'Squeeze the abs at the top for a beat.',
      'Lower slowly without resting your head between reps.',
    ],
    watch: 'Making it a mini sit-up. The lower back stays on the floor — the range is small and that is correct.',
  },
  {
    id: 'mountain-climbers',
    match: /mountain climber/,
    setup: 'Set up in a push-up position with your hands under your shoulders and your body in one line.',
    steps: [
      'Drive one knee toward your chest without letting your hips rise.',
      'Switch legs quickly, keeping the shoulders stacked over the hands.',
      'Keep a steady rhythm for the set time rather than sprinting and stalling.',
    ],
    watch: 'Hips bouncing up and down. Keep them level; slow the pace if that\'s what it takes.',
  },

  // ── Cardio ───────────────────────────────────────────────────────────────
  {
    id: 'run',
    match: /^running$|\bjog/,
    setup: 'Start with five minutes of easy movement to warm up before the session proper.',
    steps: [
      'Run tall, with your foot landing under your hips rather than out in front of you.',
      'Keep your cadence quick and your shoulders and hands relaxed.',
      'Hold the effort the session calls for — easy runs should let you talk in full sentences.',
      'Finish with a few minutes of easy jogging or walking rather than stopping dead.',
    ],
    watch: 'Running your easy days too hard. It is the most common reason a plan stops working.',
  },
  {
    id: 'bike',
    match: /^cycling$|stationary bike/,
    setup: 'Set the saddle so your knee stays slightly bent at the bottom of the pedal stroke.',
    steps: [
      'Spin up for a few minutes at a light resistance to warm up.',
      'Hold a cadence around 80–90 rpm and change the resistance, not your form, to change the effort.',
      'Keep your upper body still and relaxed; the legs do the work.',
      'Spin easy for a few minutes at the end to cool down.',
    ],
    watch: 'A saddle set too low — the fastest route to sore knees on a bike.',
  },
  {
    id: 'row-machine',
    match: /rowing machine/,
    setup: 'Strap your feet in, sit tall and take the handle with your shins vertical and your arms straight.',
    steps: [
      'Drive with the legs first, keeping the arms straight and the back locked.',
      'As the legs finish, swing the torso back slightly, then pull the handle to your lower ribs.',
      'Reverse the order exactly: arms away, then torso forward, then bend the knees.',
      'Keep the stroke rate low and the drive powerful rather than rushing the recovery.',
    ],
    watch: 'Pulling with the arms first. Legs, then back, then arms — every stroke, in that order.',
  },
  {
    id: 'jump-rope',
    match: /jump rope/,
    setup: 'Set the rope length so the handles reach about armpit height when you stand on the middle of it.',
    steps: [
      'Keep your elbows close to your ribs and turn the rope with your wrists, not your arms.',
      'Jump just an inch or two off the floor, landing on the balls of your feet.',
      'Stay relaxed and find a rhythm you can hold for the whole interval.',
    ],
    watch: 'Jumping far too high and swinging from the shoulders. Both burn you out inside a minute.',
  },
];

// Names whose obvious regex would send them somewhere wrong, or that are one
// of a kind. Checked BEFORE the patterns. Keep this list short — if it is
// growing, the pattern order is probably what needs fixing.
const EXACT = {
  'monkey row': 'upright-row',
  'poliquin raise': 'lateral-raise',
  'poliquin step-up': 'step-up',
  'bodyweight curl': 'curl',
  'bodyweight leg curl': 'leg-curl',
  // A plank with a bell dragged under you, not a hip hinge on a cable. The
  // `pull-through` pattern sits in the hinge block and claimed it first.
  'kettlebell plank pull through': 'plank',
};

const BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

function resolvePattern(lower) {
  const exact = EXACT[lower];
  if (exact) return BY_ID[exact] || null;
  return PATTERNS.find((p) => p.match.test(lower)) || null;
}

function resolveSetup(pattern, lower, implement) {
  for (const [regex, text] of pattern.setupWhen || []) {
    if (regex.test(lower)) return text;
  }
  return pattern.setupBy?.[implement] || pattern.setup;
}

function resolveSteps(pattern, lower) {
  for (const [regex, steps, watch] of pattern.stepsWhen || []) {
    if (regex.test(lower)) return { steps, watch: watch || pattern.watch };
  }
  return { steps: pattern.steps, watch: pattern.watch };
}

/**
 * The written guide for one exercise.
 *
 * @param {string} exerciseName canonical English name, as stored
 * @returns {{id: string, steps: string[], watch: string} | null}
 *          null when the name doesn't resolve — the caller renders nothing
 *          rather than inventing instructions. See rule 2 in the file head.
 */
export function guideFor(exerciseName) {
  if (typeof exerciseName !== 'string') return null;
  const lower = exerciseName.trim().toLowerCase();
  if (!lower) return null;

  const pattern = resolvePattern(lower);
  if (!pattern) return null;

  const { steps, watch } = resolveSteps(pattern, lower);
  return {
    id: pattern.id,
    steps: [resolveSetup(pattern, lower, implementOf(exerciseName)), ...steps],
    watch,
  };
}

/** Pattern id only — for the coverage test and the contact sheet. */
export function guidePatternFor(exerciseName) {
  return guideFor(exerciseName)?.id ?? null;
}

/** Every pattern id this module can return. */
export function guidePatternIds() {
  return PATTERNS.map((p) => p.id);
}
