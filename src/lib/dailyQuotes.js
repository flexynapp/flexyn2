// Daily quote rotation with no repeats until the full pool is exhausted.

export const QUOTES = [
  { text: "Don't make it 'one day.' Make today Day One.", author: null },
  { text: "A year from now you'll wish you started today.", author: 'Karen Lamb' },
  { text: "Discipline is choosing between what you want now and what you want most.", author: 'Abraham Lincoln' },
  { text: "Small steps every day add up to big change.", author: null },
  { text: "You don't have to be extreme. Just consistent.", author: null },
  { text: "The pain you feel today builds the strength you'll have tomorrow.", author: null },
  { text: "Progress, not perfection.", author: null },
  { text: "The only bad workout is the one that didn't happen.", author: null },
  { text: "You're not lazy. You're just gathering momentum. Start now.", author: null },
  { text: "Show up, even when you don't feel like it. Especially then.", author: null },
  { text: "Comparison is the thief of joy. Stay in your lane.", author: 'Theodore Roosevelt' },
  { text: "You will never regret the workout you finished.", author: null },
  { text: "Strong people aren't born. They're forged through repetition.", author: null },
  { text: "Your body can stand almost anything. It's your mind you have to convince.", author: null },
  { text: "The hardest lift is getting off the couch.", author: null },
  { text: "Don't count the days. Make the days count.", author: 'Muhammad Ali' },
  { text: "Motivation gets you started. Habit keeps you going.", author: 'Jim Rohn' },
  { text: "Rest when you need to. Quit never.", author: null },
  { text: "Be patient with yourself. Trees take years to grow.", author: null },
  { text: "If it's important to you, you'll find a way. If not, you'll find an excuse.", author: null },
  { text: "Sweat is just fat crying. Keep going.", author: null },
  { text: "You miss 100% of the workouts you skip.", author: null },
  { text: "Hard things become easier through practice. Easy things become harder through neglect.", author: null },
  { text: "Today's effort is tomorrow's strength.", author: null },
  { text: "The body achieves what the mind believes.", author: null },
  { text: "Done is better than perfect.", author: 'Sheryl Sandberg' },
  { text: "Doubt kills more dreams than failure ever will.", author: 'Suzy Kassem' },
  { text: "You don't have to be great to start. You have to start to be great.", author: 'Zig Ziglar' },
  { text: "What you do every day matters more than what you do once in a while.", author: 'Gretchen Rubin' },
  { text: "The cave you fear to enter holds the treasure you seek.", author: 'Joseph Campbell' },
  { text: "Take care of your body. It's the only place you have to live.", author: 'Jim Rohn' },
  { text: "Be the person your future self will thank.", author: null },
  { text: "Falling down is part of life. Getting back up is living.", author: null },
  { text: "Slow progress is still progress.", author: null },
  { text: "You don't find time. You make it.", author: null },
  { text: "Energy spent on doubt is energy stolen from doing.", author: null },
  { text: "The work works if you do.", author: null },
  { text: "Become someone you're proud to be.", author: null },
  { text: "Every rep is a vote for the person you want to become.", author: null },
  { text: "It's supposed to be hard. That's what makes it worth doing.", author: 'Jimmy Dugan, A League of Their Own' },
];

const SEEN_KEY = 'fn-quotes-seen';
const DAY_KEY = 'fn-quotes-current-day';
const CURRENT_KEY = 'fn-quotes-current-index';

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeSeen(seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* ignore */ }
}

// Returns { text, author } — the same quote within a single local day,
// rotates to a fresh unseen quote on the next day, and resets the
// "seen" pool once every quote has been shown.
//
// `customQuotes` ([{ id, text, author }]) are the user's own quotes (mig
// 153); they cycle in alongside the built-in pool. Each quote gets a stable
// key (`b<index>` for built-in, `c<id>` for custom) so the daily cache +
// "seen" set survive the custom list changing. Pre-key localStorage values
// simply don't match the new keys → a one-time, harmless rotation reset.
export function getDailyQuote(customQuotes = []) {
  const pool = [
    ...QUOTES.map((q, i) => ({ key: `b${i}`, text: q.text, author: q.author })),
    ...(Array.isArray(customQuotes) ? customQuotes : [])
      .filter(q => q && q.text)
      .map(q => ({ key: `c${q.id}`, text: q.text, author: q.author || null })),
  ];
  if (pool.length === 0) return null;

  const stamp = todayStamp();
  const storedDay = (() => { try { return localStorage.getItem(DAY_KEY); } catch { return null; } })();
  const storedKey = (() => { try { return localStorage.getItem(CURRENT_KEY); } catch { return null; } })();

  // Same day → reuse the cached quote IF it still exists in the pool.
  if (storedDay === stamp && storedKey) {
    const found = pool.find(p => p.key === storedKey);
    if (found) return { text: found.text, author: found.author };
    // else: the cached custom quote was deleted — fall through to re-pick.
  }

  // New day (or stale cache) → pick a key not yet seen.
  let seen = readSeen();
  let unseen = pool.filter(p => !seen.includes(p.key));
  if (unseen.length === 0) {
    seen = [];
    unseen = pool;
  }
  const pick = unseen[Math.floor(Math.random() * unseen.length)];
  seen.push(pick.key);
  writeSeen(seen);
  try {
    localStorage.setItem(DAY_KEY, stamp);
    localStorage.setItem(CURRENT_KEY, pick.key);
  } catch { /* ignore */ }
  return { text: pick.text, author: pick.author };
}