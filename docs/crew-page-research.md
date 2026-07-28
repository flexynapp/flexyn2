# The Crew page — what clan landing pages do, and what ours does instead

Research pass over the group/clan landing screens of two open-source apps,
read as **source**, not screenshots. Compared against the Crews surfaces in
`src/components/crews/`.

Read on 2026-07-27. Both are actively maintained.

| App | Repo | Files read |
|---|---|---|
| **Voyager** (Lemmy, React + Ionic) | `aeharding/voyager` | `src/features/community/CommunitySummary.tsx`, `CommunitySummary.module.css` |
| **Habitica** (habit RPG, Vue) | `HabitRPG/habitica` | `website/client/src/components/groups/{group,questSidebarSection}.vue`, plus the `groups/` tree |

Voyager is the closest **technical** analogue — React, web tech, shipped to
the App Store — and was already the reference for
[profile-ui-premium-research.md](profile-ui-premium-research.md). Habitica is
the closest **product** analogue: a real-world-activity tracker whose groups
have a shared objective, a leader, a bank, and a chat, which is precisely the
shape of a Crew.

---

## The finding that matters most

**Tapping a Crew opens a chat. Every reference opens an identity page.**

`CrewsSection.jsx:385` is the whole story:

```jsx
if (activeCrew) {
  return (
    <ChatViewportFrame>
      <CrewChat crew={activeCrew} onBack={() => setActiveCrew(null)} />
    </ChatViewportFrame>
  );
}
```

There is no Crew page. There is a crew *list*, and tapping a row goes
straight into a message thread. Everything that describes the crew — who
leads it, how big it is, what level it is, where it sits in its division,
what its treasury holds, whether it is at war — is either behind a slide-in
panel or on a different tab entirely.

Habitica's group page opens with the group as a *subject*
(`group.vue:14-21`):

```html
<h1>{{ group.name }}</h1>
<div>
  <span class="mr-1 ml-0">
    <strong v-once>{{ $t('groupLeader') }}:</strong>
    <user-link class="mx-1" :user="group.leader" />
  </span>
</div>
```

The name is an `h1` — the largest thing on the screen — and the leader is
named immediately under it. Chat exists (`groups/chat.vue`) but as *a
section within* the page, not as the page.

---

## The measured contrast

Counted, not eyeballed.

| | Voyager | Habitica | **Flexyn Crews** |
|---|---|---|---|
| What tapping the group opens | community page | group page | **a chat thread** |
| Distinct type sizes on the summary | 2 (`0.9rem` / `0.875em`) | 3 | **8+** (9, 10, 11 px + xs/sm/base/lg/xl) |
| Bordered containers | **0** | small icon row | **102 border utilities** across 6 files |
| Rounded card containers | 0 | 0 | **38** |
| Uppercase micro-labels | 0 | 0 | **16** |
| Counts formatted | `formatNumber` → `12.4K` | `\| abbrNum` | **raw integers** |
| Group state on the landing screen | subscribers, age, description | members, bank, quest status, leader | **none of it** |
| Primary action position | in the title row | top of page | **on another tab** |

The 9 px and 10 px sizes are the same below-the-legibility-floor problem the
profile research flagged, reappearing in a second area of the app.

---

## Three things both references do that we don't

### 1. The group's own state is on the group's own page

Voyager's entire summary is a title row, one stats line, and a description
(`CommunitySummary.tsx:38-70`). The stats line is one string with `·`
separators:

```tsx
<div className={styles.stats}>
  {formatNumber(community.community.subscribers)} Subscriber
  {community.community.subscribers !== 1 ? "s" : ""} ·{" "}
  <Ago date={community.community.published_at} /> Old{" "}
</div>
```

Two type sizes in the whole component, from the CSS module:

```css
.stats       { font-size: 0.9rem; color: var(--ion-color-medium); }
.description { font-size: 0.875em; }
```

Habitica goes further and makes each summary number a *tap target that opens
a modal* — member count opens the member list, the gem count opens the bank
(`group.vue:29-75`). One row of numbers is simultaneously the summary and
the navigation.

Nice detail worth stealing: the member-count badge is **tiered by group
size** — bronze under 100, silver 100–999, gold above 1000
(`group.vue:38-50`). Status expressed through the group's own scale, with no
extra chrome.

Ours has all of this data now — migrations 248–251 added level, trophies,
division standing, war record and a treasury — **and shows none of it when
you open a Crew.**

### 2. All states of the shared objective live in one place

`questSidebarSection.vue` renders three mutually exclusive states in a
single section:

- **no quest** → icon, heading, explanatory copy, and a `Select Quest` button
- **invited** → `invitedToThisQuest` with inline Accept / Reject
- **active** → the boss sprite and progress

That is exactly the shape of a Crew War: none / queued / active. We have all
three states implemented and correct — `BattleEntryRow` in
`CrewsSection.jsx` handles no-war, queued and active properly — but they
render on a **separate Battles tab**, so a member looking at their crew sees
no indication that the crew is three days into a war it is losing.

### 3. Numbers are abbreviated

Both use an abbreviation helper (`formatNumber`, `abbrNum`). We ship
`formatNumber` in `src/lib/intl.js` and the newer crew components use it,
but the older ones print raw integers.

---

## What I'd change, in order

Ordered by payoff per unit of risk. **None of this needs a migration** —
every number below is already in the database and already has a data-layer
function.

**1. Make tapping a Crew open a Crew page, not a chat.**
Chat becomes a tab on that page. This is the change that makes the other
six possible, and it is mostly a routing change: `CrewChat` already exists
and keeps working, it just stops being the whole destination.

**2. Give the page a header that names the crew.**
Banner, crest overlapping the seam ringed in the page background, crew name
as the largest element, leader named underneath — the pattern already
validated in the profile work and used by both references.

**3. One text metric row, not tiles.**
`Lvl 12 · 4th in Division 3 · 24–9 · 2.4K coins`, one type size, hierarchy
from weight and colour. Every value is already returned by
`getMyCrews`, `getDivisionStandings` and `getTreasury`.

**4. Put war status on the page, with its action inline.**
Lift `BattleEntryRow`'s three states out of the Battles tab and onto the
crew page, Habitica-style. A crew at war should not have to go looking for
its war.

**5. Segment the body instead of stacking it.**
`Home · Roster · Chat · League`. The roster, treasury and join-request queue
currently live inside one slide-in panel that is also, separately, the only
way to manage the crew.

**6. Cap the type scale and strip the borders.**
Four sizes, and separation by whitespace and hairlines. 102 border
utilities across six files is what makes the area read as a settings screen
rather than a clan.

**7. Abbreviate every count.** `useNumberFormatter` is already imported in
half these files.

---

## What we should *not* copy

Habitica's group page is a desktop-first Bootstrap grid with a right
sidebar, and Voyager's community summary is a *list row*, not a landing
page. Neither is a template to trace. The transferable ideas are narrower
and specific:

- the group is a subject with a name and a leader, not a conversation
- its own state belongs on its own page
- the shared objective shows all its states in one place, with the action inline
- summary numbers double as navigation

And the same caveat the profile research ended on applies here. Crew Wars,
divisions, trophies and the treasury **are** the product — the answer is not
to have less, it is that both references render more information than we do
inside far less chrome.

## Sources

- [aeharding/voyager](https://github.com/aeharding/voyager) — MIT
- [HabitRPG/habitica](https://github.com/HabitRPG/habitica) — GPL-3.0, read for mechanics and layout only
