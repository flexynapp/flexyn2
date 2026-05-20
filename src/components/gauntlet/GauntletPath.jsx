// src/components/gauntlet/GauntletPath.jsx
// Duolingo-style winding SVG path — 10 nodes in a zigzag, colored from the
// start up to wherever the user currently is. Tap any node to see its detail.

// ── Layout constants (SVG user-units, viewBox = "0 0 320 H") ─────────────────
const W       = 320;   // viewBox width
const NODE_R  = 27;    // circle radius
const V_GAP   = 118;   // vertical distance between node centres
const PAD_TOP = 52;    // space above node 1
const PAD_BOT = 50;    // space below node 10

// Horizontal positions for each sequence index (0-based)
// Even = left column, Odd = right column, last = centre
const nodeX = (i, total) => {
  if (i === total - 1) return W / 2;   // finale always centred
  return i % 2 === 0 ? 82 : 238;
};
const nodeY = (i) => PAD_TOP + i * V_GAP;
const totalH = (n) => PAD_TOP + (n - 1) * V_GAP + PAD_BOT;

// Where to anchor the challenge-name label relative to the node
const labelAnchor = (i, total) => {
  if (i === total - 1) return 'middle';
  return i % 2 === 0 ? 'start' : 'end';
};
const labelX = (i, total) => {
  const x = nodeX(i, total);
  if (i === total - 1) return x;
  return i % 2 === 0 ? x + NODE_R + 10 : x - NODE_R - 10;
};

// Cubic-bezier path between two consecutive nodes (smooth S-curve)
const segD = (i, total) => {
  const x1 = nodeX(i, total);   const y1 = nodeY(i);
  const x2 = nodeX(i + 1, total); const y2 = nodeY(i + 1);
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
};

// Challenge-type short badge
const TYPE_LABEL = {
  single_session: 'Session',
  weekly_volume:  'Weekly Vol.',
  streak:         'Streak',
  nutrition:      'Nutrition',
  pr:             'PR',
  final:          'Final',
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props:
 *   challenges       — array of gauntlet_challenges rows (ordered by sequence_number)
 *   currentSequence  — user's current_challenge_sequence (1 if never started)
 *   completedSeqs    — Set<number> of completed sequence numbers
 *   selectedId       — challenge.id currently tapped (or null)
 *   onSelectChallenge(challenge | null) — tap-to-select callback
 */
export default function GauntletPath({
  challenges = [],
  currentSequence = 1,
  completedSeqs = new Set(),
  selectedId = null,
  onSelectChallenge,
}) {
  const n = challenges.length;
  if (n === 0) return null;
  const svgH = totalH(n);

  const getStatus = (seq) => {
    if (completedSeqs.has(seq)) return 'completed';
    if (seq === currentSequence)  return 'active';
    if (seq === currentSequence + 1) return 'next';
    return 'locked';
  };

  // Fill / stroke colours per status
  const fill   = { completed: '#059669', active: '#d97706', next: '#292932', locked: '#18181f' };
  const stroke = { completed: '#34d399', active: '#fcd34d', next: '#3f3f50', locked: '#2a2a38' };
  const txtClr = { completed: '#fff',    active: '#fff',    next: '#6b7280', locked: '#374151' };

  return (
    <svg
      viewBox={`0 0 ${W} ${svgH}`}
      className="w-full select-none"
      style={{ display: 'block' }}
    >
      <defs>
        {/* Gradient along the completed path — vertical purple → amber */}
        <linearGradient id="gpath" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>

        {/* Radial glow for active node */}
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#fcd34d" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fcd34d" stopOpacity="0" />
        </radialGradient>

        {/* Drop shadow filter for completed nodes */}
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#059669" floodOpacity="0.45" />
        </filter>
        <filter id="shadowAmber" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#f59e0b" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* ── Path segments ──────────────────────────────────────────────────── */}
      {challenges.slice(0, -1).map((ch, i) => {
        const status = getStatus(ch.sequence_number);
        const d = segD(i, n);
        const done = status === 'completed';

        return (
          <g key={`seg-${i}`}>
            {/* Base gray track (always visible — forms the "not yet reached" trail) */}
            <path
              d={d}
              fill="none"
              stroke="#23232f"
              strokeWidth={10}
              strokeLinecap="round"
            />
            {/* Dashed markers on incomplete segments */}
            {!done && (
              <path
                d={d}
                fill="none"
                stroke="#2e2e3e"
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray="1 14"
              />
            )}
            {/* Coloured overlay on completed segments */}
            {done && (
              <path
                d={d}
                fill="none"
                stroke="url(#gpath)"
                strokeWidth={7}
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}

      {/* ── Nodes ──────────────────────────────────────────────────────────── */}
      {challenges.map((ch, i) => {
        const seq    = ch.sequence_number;
        const status = getStatus(seq);
        const cx     = nodeX(i, n);
        const cy     = nodeY(i);
        const isSel  = ch.id === selectedId;
        const isActive = status === 'active';
        const isDone   = status === 'completed';

        return (
          <g
            key={ch.id}
            onClick={() => onSelectChallenge?.(isSel ? null : ch)}
            style={{ cursor: 'pointer' }}
          >
            {/* Pulsing glow ring on active node */}
            {isActive && (
              <>
                <circle cx={cx} cy={cy} r={NODE_R + 14} fill="url(#glow)">
                  <animate
                    attributeName="r"
                    values={`${NODE_R + 10};${NODE_R + 20};${NODE_R + 10}`}
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.7;0;0.7"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                </circle>
              </>
            )}

            {/* Selection ring */}
            {isSel && (
              <circle
                cx={cx} cy={cy}
                r={NODE_R + 6}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={2}
              />
            )}

            {/* Node circle */}
            <circle
              cx={cx} cy={cy}
              r={NODE_R}
              fill={fill[status]}
              stroke={stroke[status]}
              strokeWidth={isDone ? 2.5 : 2}
              filter={isDone ? 'url(#shadow)' : isActive ? 'url(#shadowAmber)' : undefined}
            />

            {/* Centre glyph: ✓ for done, sequence number otherwise */}
            <text
              x={cx} y={cy + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={isDone ? 15 : 13}
              fontWeight="700"
              fill={txtClr[status]}
              style={{ fontFamily: 'system-ui, sans-serif', letterSpacing: '-0.5px' }}
            >
              {isDone ? '✓' : seq}
            </text>

            {/* ── Challenge name label ───────────────────────────────────── */}
            <text
              x={labelX(i, n)}
              y={cy}
              textAnchor={labelAnchor(i, n)}
              dominantBaseline="middle"
              fontSize={9.5}
              fontWeight={isActive ? '700' : '500'}
              fill={
                isDone
                  ? '#34d399'
                  : isActive
                    ? '#fcd34d'
                    : status === 'next'
                      ? '#4b5563'
                      : '#2e2e3e'
              }
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              {ch.title.length > 14 ? ch.title.slice(0, 13) + '…' : ch.title}
            </text>

            {/* Type badge below label on active + next */}
            {(isActive || status === 'next') && (
              <text
                x={labelX(i, n)}
                y={cy + 13}
                textAnchor={labelAnchor(i, n)}
                dominantBaseline="middle"
                fontSize={8}
                fontWeight="600"
                fill={isActive ? '#b45309' : '#374151'}
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                {TYPE_LABEL[ch.type] ?? ch.type}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
