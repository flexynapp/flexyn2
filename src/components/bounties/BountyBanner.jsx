// src/components/bounties/BountyBanner.jsx
// Persistent banner in Workout idle view when user has an active bounty claim.
// Same pattern as DuelBanner.

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Zap, Clock, ChevronRight } from 'lucide-react';
import { differenceInHours, differenceInMinutes } from 'date-fns';
import { bountyDescription } from '@/lib/data/bounties';
import { useNavigate } from 'react-router-dom';

function timeRemaining(deadline) {
  const now = new Date();
  const end = new Date(deadline);
  const hours = differenceInHours(end, now);
  const mins  = differenceInMinutes(end, now) % 60;
  if (hours <= 0 && mins <= 0) return 'Expired';
  if (hours === 0) return `${mins}m left`;
  return `${hours}h ${mins}m left`;
}

export default function BountyBanner({ claim }) {
  const navigate = useNavigate();
  const [timeStr, setTimeStr] = useState(() => timeRemaining(claim?.deadline));

  useEffect(() => {
    if (!claim?.deadline) return;
    const id = setInterval(() => setTimeStr(timeRemaining(claim.deadline)), 60_000);
    return () => clearInterval(id);
  }, [claim?.deadline]);

  if (!claim || !claim.bounties) return null;

  const bounty = claim.bounties;
  const isExpiring = differenceInHours(new Date(claim.deadline), new Date()) < 12;

  return (
    <motion.button
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate('/bounties')}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-colors mb-3 ${
        isExpiring
          ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10'
          : 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
      }`}
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
        isExpiring ? 'bg-rose-500/15' : 'bg-amber-500/15'
      }`}>
        <Zap className={`w-4 h-4 ${isExpiring ? 'text-rose-500' : 'text-amber-500'}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-amber-600">
            Active Bounty
          </span>
          {isExpiring && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500">
              Expiring Soon
            </span>
          )}
        </div>
        <p className="text-xs font-semibold text-foreground truncate mt-0.5">
          {bountyDescription(bounty)}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>{timeStr}</span>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
    </motion.button>
  );
}
