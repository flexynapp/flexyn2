// src/components/crews/CrewMemberDots.jsx
//
// Horizontal cluster of overlapping avatar circles representing a crew's
// most-active members. Used in crew list cards and crew chat headers to
// humanize the group — instead of "15 members" you see actual faces,
// which makes joining feel like joining a community of people rather
// than an abstract group label.
//
// Slack uses this pattern for channels, Discord for server lists.
//
// Props:
//   members       Array of { email, username, avatar_url }
//   max           Max avatars to display before collapsing to "+N" (default 5)
//   size          Avatar diameter in px (default 24)
//   totalCount    Optional — total crew member count, used for the "+N" math
//                 if you have it cached separately from `members`

import { motion } from 'framer-motion';

function colorForEmail(email) {
  // Deterministic per-email color so initials avatars get consistent
  // colors across sessions. Cheap hash → HSL slice.
  let h = 0;
  for (let i = 0; i < (email || '').length; i++) {
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360} 55% 45%)`;
}

function initialsOf(member) {
  const src = member.username || member.email || '';
  return src.trim().slice(0, 2).toUpperCase() || '?';
}

export default function CrewMemberDots({ members = [], max = 5, size = 24, totalCount }) {
  if (!Array.isArray(members) || members.length === 0) return null;

  const visible = members.slice(0, max);
  const remaining = (totalCount ?? members.length) - visible.length;

  // Overlap: each subsequent avatar is shifted left by ~35% of its
  // width so the cluster reads as a unit, not a row.
  const overlap = Math.round(size * 0.35);

  return (
    <div className="inline-flex items-center" aria-label={`${totalCount ?? members.length} crew members`}>
      {visible.map((member, i) => (
        <motion.div
          key={member.email || i}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.05, type: 'spring', stiffness: 380, damping: 25 }}
          className="relative rounded-full overflow-hidden border-2 border-card flex items-center justify-center text-white text-[10px] font-bold select-none"
          style={{
            width: size,
            height: size,
            marginLeft: i === 0 ? 0 : -overlap,
            zIndex: visible.length - i,
            backgroundColor: colorForEmail(member.email),
          }}
        >
          {member.avatar_url ? (
            <img loading="lazy" src={member.avatar_url}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <span>{initialsOf(member)}</span>
          )}
        </motion.div>
      ))}
      {remaining > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: visible.length * 0.05, type: 'spring', stiffness: 380, damping: 25 }}
          className="relative rounded-full border-2 border-card flex items-center justify-center text-[10px] font-bold select-none bg-secondary text-foreground"
          style={{
            width: size,
            height: size,
            marginLeft: -overlap,
          }}
        >
          +{remaining > 99 ? '99' : remaining}
        </motion.div>
      )}
    </div>
  );
}
