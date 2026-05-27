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
  { text: "The successful warrior is the average man, with laser-like focus.", author: 'Bruce Lee' },
  { text: "Whether you think you can or you think you can't, you're right.", author: 'Henry Ford' },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: 'Confucius' },
  { text: "Strength does not come from winning. Your struggles develop your strengths.", author: 'Arnold Schwarzenegger' },
  { text: "The last three or four reps is what makes the muscle grow.", author: 'Arnold Schwarzenegger' },
  { text: "Hard work beats talent when talent doesn't work hard.", author: 'Tim Notke' },
  { text: "It's not whether you get knocked down; it's whether you get up.", author: 'Vince Lombardi' },
  { text: "I've failed over and over again in my life. And that is why I succeed.", author: 'Michael Jordan' },
  { text: "Champions keep playing until they get it right.", author: 'Billie Jean King' },
  { text: "The difference between the impossible and the possible lies in determination.", author: 'Tommy Lasorda' },
  { text: "Discipline is the bridge between goals and accomplishment.", author: 'Jim Rohn' },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: 'Will Durant' },
  { text: "Nothing will work unless you do.", author: 'Maya Angelou' },
  { text: "Energy and persistence conquer all things.", author: 'Benjamin Franklin' },
  { text: "Action is the foundational key to all success.", author: 'Pablo Picasso' },
  { text: "Well done is better than well said.", author: 'Benjamin Franklin' },
  { text: "The future depends on what you do today.", author: 'Mahatma Gandhi' },
  { text: "Set your goals high, and don't stop till you get there.", author: 'Bo Jackson' },
  { text: "Believe you can and you're halfway there.", author: 'Theodore Roosevelt' },
  { text: "Tough times never last, but tough people do.", author: 'Robert H. Schuller' },
  { text: "Don't limit your challenges. Challenge your limits.", author: null },
  { text: "Wake up with determination. Go to bed with satisfaction.", author: null },
  { text: "Push yourself, because no one else is going to do it for you.", author: null },
  { text: "Great things never came from comfort zones.", author: null },
  { text: "Success starts with self-discipline.", author: null },
  { text: "Train insane or remain the same.", author: null },
  { text: "When you feel like quitting, think about why you started.", author: null },
  { text: "Your only limit is you.", author: null },
  { text: "Fall in love with the process and the results will come.", author: null },
  { text: "Sore today, strong tomorrow.", author: null },
  { text: "Excuses don't burn calories.", author: null },
  { text: "The pain of discipline weighs ounces. The pain of regret weighs tons.", author: null },
  { text: "Don't wish for it. Work for it.", author: null },
  { text: "If you want something you've never had, you must do something you've never done.", author: null },
  { text: "Strive for progress, not perfection.", author: null },
  { text: "A little progress each day adds up to big results.", author: null },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: null },
  { text: "Don't stop when you're tired. Stop when you're done.", author: null },
  { text: "Your future is created by what you do today, not tomorrow.", author: null },
  { text: "Be stronger than your excuses.", author: null },
  { text: "Results happen over time, not overnight. Work hard, stay consistent, be patient.", author: null },
  { text: "Your body hears everything your mind says. Stay positive.", author: null },
  { text: "The hardest part of any workout is starting. You already did that by showing up.", author: null },
  { text: "Sweat now, shine later.", author: null },
  { text: "One more rep. One more day. One step closer.", author: null },
  { text: "You don't get what you wish for. You get what you work for.", author: null },
  { text: "Fitness is not about being better than someone else. It's about being better than you used to be.", author: null },
  { text: "The grind doesn't stop, and neither do you.", author: null },
  { text: "Consistency beats intensity. Show up again tomorrow.", author: null },
  { text: "Earn your body. Respect your effort.", author: null },
  { text: "Make yourself proud.", author: null },
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
// The full ordered pool used by both the daily pick and the swipe carousel:
// built-in quotes first (stable `b<index>` keys), then the user's custom
// quotes (`c<id>` keys). Exported so the carousel can page through every
// quote, not just today's.
export function getQuotePool(customQuotes = []) {
  return [
    ...QUOTES.map((q, i) => ({ key: `b${i}`, text: q.text, author: q.author })),
    ...(Array.isArray(customQuotes) ? customQuotes : [])
      .filter(q => q && q.text)
      .map(q => ({ key: `c${q.id}`, text: q.text, author: q.author || null })),
  ];
}

export function getDailyQuote(customQuotes = []) {
  const pool = getQuotePool(customQuotes);
  if (pool.length === 0) return null;

  const stamp = todayStamp();
  const storedDay = (() => { try { return localStorage.getItem(DAY_KEY); } catch { return null; } })();
  const storedKey = (() => { try { return localStorage.getItem(CURRENT_KEY); } catch { return null; } })();

  // Same day → reuse the cached quote IF it still exists in the pool.
  if (storedDay === stamp && storedKey) {
    const found = pool.find(p => p.key === storedKey);
    if (found) return { key: found.key, text: found.text, author: found.author };
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
  return { key: pick.key, text: pick.text, author: pick.author };
}