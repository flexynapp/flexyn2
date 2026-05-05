# Flexyn — Pre-Ship Verification Checklist

A repeatable checklist to catch crash-class bugs before they hit users.
Run through every section that touches the changed component(s).

---

## 1. Render Safety — "Will it throw?"

Every component that reads external data (Supabase, localStorage, props) must
handle the case where that data is missing, malformed, or an unexpected type.

### Date / time values
- [ ] Never call `new Date(value)` directly — always use `parseISO(String(value))` from date-fns.
- [ ] Always guard with `isValid(d)` before passing to `format()`, `differenceInYears()`, or any date utility.
- [ ] Wrap in the project-wide `safeDateFormat(value, fmt)` helper (src/components/progress/BodyMetricsTab.jsx) or a local equivalent.

### Numeric values
- [ ] Coerce with `Number(x) || 0` before arithmetic — never assume a DB field is already a number.
- [ ] Guard division: `denominator !== 0` before dividing.

### Array / object access
- [ ] Optional-chain all optional fields: `user?.profile?.weight_lbs`.
- [ ] Default array props: `const items = props.items ?? []`.
- [ ] `.flatMap()` / `.map()` on data from Supabase — confirm it is actually an array first.

### String operations
- [ ] `.toLowerCase()` / `.split()` — confirm the value is a string, not null/undefined.

---

## 2. Error Boundary Coverage

All top-level tab components rendered inside page route components must be
wrapped with `<ErrorBoundary label="ComponentName">`.

### Current coverage
| Page / Component | Wrapped? |
|-----------------|----------|
| `/dashboard` | ✅ App.jsx (route-level) |
| `/nutrition` | ✅ App.jsx (route-level) |
| `/workout` | ✅ App.jsx (route-level) |
| `/hub` | ✅ App.jsx (route-level) |
| `/progress` | ✅ App.jsx (route-level) |
| `<BodyMetricsTab />` | ✅ Progress.jsx (tab-level) |
| `<ProgressPhotosTab />` | ✅ Progress.jsx (tab-level) |
| `<AnalyticsTab />` | ✅ Progress.jsx (tab-level) |
| `<GroupedExerciseTrends />` (exercise trends) | ✅ Progress.jsx (tab-level) |

### How to add coverage to a new tab
```jsx
import ErrorBoundary from '@/components/ErrorBoundary';

// In the render:
<ErrorBoundary label="MyNewTab">
  <MyNewTab />
</ErrorBoundary>
```

### Verification step
After adding a new tab: temporarily throw inside the component's render
(`throw new Error('test')`) → confirm the friendly error UI appears instead
of a blank screen → remove the throw.

---

## 3. Profanity Filter Verification

After any change to `src/lib/profanityFilter.js`:

### Run the audit script
```bash
node debug-profanity.mjs
```
The script tests common innocent words and phrases. All should return `false`.

### Key phrases to manually spot-check
| Phrase | Expected |
|--------|----------|
| `"clockwork"` | false |
| `"a city block"` | false |
| `"a narrow passage"` | false |
| `"Cockburn Street"` | false |
| `"Scunthorpe"` | false |
| `"passage"` | false |
| `"classic"` | false |
| `"analyst"` | false |
| Messages in DM context `{ context: 'dm' }` | always false |

### DM bypass
```js
containsProfanity(text, { context: 'dm' }) // must always return false
```

---

## 4. Anti-Cheat / Weight Limits

After any change to `src/lib/realisticLimits.js` or `src/pages/Workout.jsx`:

- [ ] Test a known heavy lift (e.g. 500 lb deadlift at 180 lb bodyweight) — should NOT flag.
- [ ] Test an obviously impossible lift (e.g. 2000 lb bench press) — MUST flag with dialog.
- [ ] Test reps: 50 reps at a reasonable weight — should NOT flag.
- [ ] Test reps: 200 reps at a heavy weight — MUST flag with dialog.
- [ ] Confirm "Go Back & Fix" clears only the flagged field(s) — does not zero out valid data.
- [ ] Confirm no silent clamping — if a value is wrong, a dialog must appear.

---

## 5. XP System Sanity Checks

After any change to `src/lib/xpSystem.js`:

- [ ] Beginner session (3 exercises × 3 sets × moderate weight, ~20 min): expect 60–120 XP.
- [ ] Intermediate session (5 exercises × 4 sets × heavier weight, ~45 min): expect 180–400 XP.
- [ ] Advanced session (6 exercises × 5 sets × heavy, ~65 min): expect 450–900 XP.
- [ ] Cardio 20 min run: expect 30–60 XP.
- [ ] Cardio 60 min run: expect 90–150 XP.
- [ ] Single workout XP never exceeds `MAX_WORKOUT_XP` (1000).
- [ ] Single cardio XP never exceeds `MAX_CARDIO_XP` (600).
- [ ] Daily total never exceeds `DAILY_XP_CAP` (2500).

---

## 6. File Picker / Upload (Hub DMs)

After any change to `src/components/hub/HubChat.jsx` or `src/lib/data/hubMessages.js`:

- [ ] Pick image ≤5MB → preview strip appears above composer.
- [ ] Pick image >5MB → toast error appears, no upload attempted.
- [ ] Send message with attachment → image renders in bubble immediately (blob URL).
- [ ] After poll (~5s) → real Supabase URL replaces blob URL, image still visible.
- [ ] Tap image in bubble → opens full-res in new tab.
- [ ] Send text-only message → works normally, no attachment state leaking.
- [ ] Send attachment-only (no text) → works, image bubble shows with no text.
- [ ] ✕ dismiss button clears the attachment preview without clearing the text.

---

## 7. General Pre-Ship Checks

- [ ] `npm run build` passes with no TypeScript / ESLint errors.
- [ ] No `console.error` in browser console for the happy path.
- [ ] Supabase migrations (if any) have been run in the SQL Editor and confirmed.
- [ ] Tested on mobile viewport (375px) — no layout overflow or hidden buttons.
- [ ] Tested on desktop viewport (1280px) — sidebar layout correct.

---

## Crash-Class Bug Quick Reference

| Symptom | Likely Cause | Fix Pattern |
|---------|-------------|-------------|
| Blank screen on tab switch | Unhandled render error, no ErrorBoundary | Wrap tab in `<ErrorBoundary>`, fix the underlying throw |
| `RangeError: Invalid time value` | `new Date(badValue)` passed to date-fns `format()` | Use `parseISO` + `isValid` guard |
| `TypeError: Cannot read properties of undefined` | Missing optional chain on nullable data | Add `?.` chains + fallback defaults |
| `TypeError: x.map is not a function` | Supabase returned null instead of [] | `const arr = data ?? []` |
| Profanity false positive | Reversed/aggressive form fuzzy-matches foreign word | Add to `SKIP_REVERSE` or `CONTEXT_EXPLAINED` |
