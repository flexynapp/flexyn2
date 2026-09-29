// src/components/ProfileAvatar.jsx
//
// Your own avatar as the account menu draws it: photo, else initials, else a
// person glyph, with the verified crown on top when the account has one.
// Shared by the menu's trigger (sidebar foot, phone header) and its header
// row so the three cannot disagree.

import { User } from 'lucide-react';
import { initialsFor } from '@/lib/initials';
import { isVerified } from '@/lib/verifiedUsers';

export default function ProfileAvatar({ user, size = 36, crown = false }) {
  const initials = initialsFor(user);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full bg-primary/10 border border-border flex items-center justify-center text-label font-bold text-primary overflow-hidden">
        {user?.avatar_url ? (
          <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : user?.full_name && initials ? (
          initials
        ) : (
          <User className="w-4 h-4" aria-hidden="true" />
        )}
      </div>
      {crown && isVerified(user?.username) && (
        <svg
          width="14" height="11"
          viewBox="0 0 14 11"
          fill="none"
          aria-hidden="true"
          style={{ position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%) rotate(-10deg)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}
        >
          <path d="M1 9.5L2.5 4L5.5 7L7 1.5L8.5 7L11.5 4L13 9.5H1Z" fill="#F59E0B" stroke="#D97706" strokeWidth="0.75" strokeLinejoin="round" />
          <rect x="1" y="9.5" width="12" height="1.5" rx="0.75" fill="#D97706" />
        </svg>
      )}
    </div>
  );
}
