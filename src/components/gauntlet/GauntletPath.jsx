// src/components/gauntlet/GauntletPath.jsx
// Duolingo-style winding path: raised 3D node "buttons" in a zigzag, each
// with a per-type icon + a small number badge, colored from the start up
// to the user's current challenge. Tap any node → detail card (handled by
// the parent, which scrolls it into view + offers a "Go to Workout" CTA).

// ── Layout constants (SVG user-units, viewBox = "0 0 320 H") ─────────────────
const W       = 320;   // viewBox width
const NODE_R  = 28;    // circle radius
const DEPTH   = 6;     // 3D base offset (how far the darker base peeks below)
const V_GAP   = 122;   // vertical distance between node centres
const PAD_TOP = 56;    // space above node 1
const PAD_BOT = 56;    // space below node 10

const nodeX = (i, total) => {
  if (i === total - 1) return W / 2;
  return i % 2 === 0 ? 84 : 236;
};
const nodeY = (i) => PAD_TOP + i * V_GAP;
const totalH = (n) => PAD_TOP + (n - 1) * V_GAP + PAD_BOT;

const labelAnchor = (i, total) => {
  if (i === total - 1) return 'middle';
  return i % 2 === 0 ? 'start' : 'end';
};
const labelX = (i, total) => {
  const x = nodeX(i, total);
  if (i === total - 1) return x;
  return i % 2 === 0 ? x + NODE_R + 12 : x - NODE_R - 12;
};

const segD = (i, total) => {
  const x1 = nodeX(i, total);   const y1 = nodeY(i);
  const x2 = nodeX(i + 1, total); const y2 = nodeY(i + 1);
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
};

// Per-type icon — a little glyph on the dot so a challenge reads at a
// glance (lifting / cardio / streak / nutrition / PR / finale), instead
// of a bare number. The sequence number stays as a small corner badge.
const TYPE_EMOJI = {
  single_session: '🏋️',
  weekly_volume:  '📈',
  streak:         '🔥',
  nutrition:      '🥗',
  pr:             '🏆',
  final:          '👑',
  cardio:         '👟',
};
const emojiFor = (ch) => TYPE_EMOJI[ch?.type] || '💪';

// Vibrant [top, base] colour pairs — the base is the darker 3D underside.
// Rotated by sequence so each reached node is its own shade.
const PALETTE = [
  ['#58cc02', '#58a700'],
  ['#1cb0f6', '#1899d6'],
  ['#ce82ff', '#a568cc'],
  ['#ff9600', '#e08600'],
  ['#2dd4bf', '#14a89a'],
  ['#fb6f92', '#e05680'],
  ['#a3e635', '#7cb518'],
  ['#ff4b4b', '#e63b3b'],
  ['#22d3ee', '#0bb8d4'],
  ['#f97316', '#ea580c'],
];
const LOCKED = ['#e5e7eb', '#cfd4da'];
const ACTIVE = ['#ffc800', '#e6a700'];

// Reward-chest milestones sit BETWEEN challenges (Duolingo treasure-chest
// vibe). Value = the sequence number after which a chest appears, so [3,6]
// puts chests between 3–4 and 6–7. Visual for now: gold + glowing once the
// preceding challenge is cleared, gray + closed while still locked.
const CHEST_AFTER = [3, 6];

function ChestNode({ cx, cy, available, onTap }) {
  const lid  = available ? '#fcd34d' : '#e5e7eb';
  const body = available ? '#f59e0b' : '#d1d5db';
  const edge = available ? '#b45309' : '#9ca3af';
  const w = 32;
  const h = 26;
  const x = cx - w / 2;
  const y = cy - h / 2;
  // Invisible hit-target — larger than the chest art so it's easy to tap
  const hitR = 28;
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={onTap}
      role="button"
      aria-label={available ? 'Open reward chest' : 'Locked chest'}
    >
      {/* Glow + bob animation for unlocked chests */}
      {available && (
        <g>
          <circle cx={cx} cy={cy} r={23} fill="url(#gauntletGlow)">
            <animate attributeName="opacity" values="0.75;0.2;0.75" dur="2s" repeatCount="indefinite" />
          </circle>
        </g>
      )}
      <rect x={x} y={y + 8} width={w} height={h - 8} rx={3} fill={body} stroke={edge} strokeWidth={1.5} />
      <rect x={x} y={y} width={w} height={11} rx={3} fill={lid} stroke={edge} strokeWidth={1.5} />
      <rect x={cx - 3.5} y={cy - 1} width={7} height={8} rx={1.5} fill={edge} />
      {/* Transparent hit-target to make the small chest easier to tap */}
      <circle cx={cx} cy={cy} r={hitR} fill="transparent" />
    </g>
  );
}

export default function GauntletPath({
  challenges = [],
  currentSequence = 1,
  completedSeqs = new Set(),
  selectedId = null,
  onSelectChallenge,
  onChestTap,
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

  return (
    <svg
      viewBox={`0 0 ${W} ${svgH}`}
      className="w-full select-none"
      style={{ display: 'block' }}
    >
      <defs>
        <radialGradient id="gauntletGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ffc800" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ffc800" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── Connecting path segments ──────────────────────────────────────── */}
      {challenges.slice(0, -1).map((ch, i) => {
        const done = getStatus(ch.sequence_number) === 'completed';
        const d = segD(i, n);
        return (
          <g key={`seg-${i}`}>
            <path d={d} fill="none" stroke="#e5e7eb" strokeWidth={11} strokeLinecap="round" />
            {!done && (
              <path d={d} fill="none" stroke="#d4d4d8" strokeWidth={6} strokeLinecap="round" strokeDasharray="1 15" />
            )}
            {done && (
              <path d={d} fill="none" stroke="#58cc02" strokeWidth={8} strokeLinecap="round" />
            )}
          </g>
        );
      })}

      {/* ── Reward chests between challenges (3–4, 6–7) ───────────────────── */}
      {CHEST_AFTER.map((afterSeq) => {
        const i = challenges.findIndex(c => c.sequence_number === afterSeq);
        if (i < 0 || i + 1 >= n) return null;
        const mx = (nodeX(i, n) + nodeX(i + 1, n)) / 2;
        const my = (nodeY(i) + nodeY(i + 1)) / 2;
        return <ChestNode key={`chest-${afterSeq}`} cx={mx} cy={my} available={completedSeqs.has(afterSeq)}
          onTap={onChestTap ? () => onChestTap(afterSeq, completedSeqs.has(afterSeq)) : undefined} />;
      })}

      {/* ── Nodes ──────────────────────────────────────────────────────────── */}
      {challenges.map((ch, i) => {
        const seq      = ch.sequence_number;
        const status   = getStatus(seq);
        const cx       = nodeX(i, n);
        const cy       = nodeY(i);
        const isSel    = ch.id === selectedId;
        const isActive = status === 'active';
        const isLocked = status === 'locked';
        const [top, base] =
          isLocked ? LOCKED : isActive ? ACTIVE : PALETTE[i % PALETTE.length];

        return (
          <g
            key={ch.id}
            onClick={() => onSelectChallenge?.(isSel ? null : ch)}
            style={{ cursor: 'pointer' }}
          >
            {/* Active node bobs gently + glows (the "you are here" beacon). */}
            {isActive && (
              <>
                <circle cx={cx} cy={cy} r={NODE_R + 16} fill="url(#gauntletGlow)">
                  <animate attributeName="r" values={`${NODE_R + 10};${NODE_R + 20};${NODE_R + 10}`} dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.2s" repeatCount="indefinite" />
                </circle>
                <animateTransform attributeName="transform" type="translate" values="0 0; 0 -3.5; 0 0" dur="1.7s" repeatCount="indefinite" />
              </>
            )}

            {/* Selection ring */}
            {isSel && (
              <circle cx={cx} cy={cy} r={NODE_R + 7} fill="none" stroke={base} strokeWidth={3} strokeOpacity={0.6} />
            )}

            {/* 3D base (darker underside) */}
            <circle cx={cx} cy={cy + DEPTH} r={NODE_R} fill={base} />
            {/* Main top face */}
            <circle cx={cx} cy={cy} r={NODE_R} fill={top} />
            {/* Top sheen */}
            <ellipse cx={cx} cy={cy - NODE_R * 0.34} rx={NODE_R * 0.62} ry={NODE_R * 0.3} fill="#ffffff" opacity={isLocked ? 0.25 : 0.22} />

            {/* Center icon */}
            <text
              x={cx} y={cy + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={26}
              opacity={isLocked ? 0.45 : 1}
              style={{ pointerEvents: 'none' }}
            >
              {emojiFor(ch)}
            </text>

            {/* Number badge (top-right) — keeps the path numbered */}
            <g style={{ pointerEvents: 'none' }}>
              <circle cx={cx + NODE_R * 0.74} cy={cy - NODE_R * 0.74} r={10} fill="#ffffff" stroke={base} strokeWidth={2} />
              <text
                x={cx + NODE_R * 0.74} y={cy - NODE_R * 0.74 + 0.5}
                textAnchor="middle" dominantBaseline="central"
                fontSize={11} fontWeight="800"
                fill={isLocked ? '#9ca3af' : base}
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {status === 'completed' ? '✓' : seq}
              </text>
            </g>

            {/* Challenge name label */}
            <text
              x={labelX(i, n)} y={cy}
              textAnchor={labelAnchor(i, n)}
              dominantBaseline="central"
              fontSize={10}
              fontWeight={isActive ? '800' : '600'}
              fill={
                status === 'completed' ? '#16a34a'
                : isActive ? '#d97706'
                : status === 'next' ? '#6b7280'
                : '#9ca3af'
              }
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {(() => {
                // Slice by Unicode code points, not JS string units —
                // a naive `.slice(0, 13)` cut multi-code-unit emoji
                // (flags, ZWJ sequences) in half and rendered the
                // replacement character. (Audit 15 #L5.)
                const codePoints = Array.from(ch.title || '');
                return codePoints.length > 14
                  ? codePoints.slice(0, 13).join('') + '…'
                  : ch.title;
              })()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
