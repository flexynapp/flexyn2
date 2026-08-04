// src/components/hub/LiveSessionCard.jsx
//
// Feed card for an active live workout session.
// Shown at the top of Squad/Pump feeds when any followed user is live.
// Subscribes to the Realtime channel for the session so exercise state
// updates instantly without polling the DB.

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Users, Dumbbell } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import * as hubLiveSessions from '@/lib/data/hubLiveSessions';

export default function LiveSessionCard({ session, onViewProfile }) {
  const { user } = useAuth();
  const [liveData, setLiveData] = useState({
    exercise: session.current_exercise,
    set:      session.current_set,
    reps:     session.current_reps,
  });
  const [viewers, setViewers] = useState(session.viewer_count || 0);
  const channelRef = useRef(null);

  const handle = 'Athlete';

  useEffect(() => {
    // Subscribe to Realtime for live updates
    const channel = supabase.channel(`live-session-${session.id}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'activity' }, ({ payload }) => {
        setLiveData({ exercise: payload.exercise, set: payload.set, reps: payload.reps });
      })
      .on('presence', { event: 'sync' }, () => {
        setViewers(Object.keys(channel.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && user?.email) {
          await channel.track({ viewer: user.email, role: 'viewer' });
          hubLiveSessions.joinSession(session.id).catch(() => {});
        }
      });

    channelRef.current = channel;
    // removeChannel (not unsubscribe) so the channel is deregistered from
    // the client registry — otherwise each card mount/unmount leaks a
    // zombie `live-session-<id>` channel.
    return () => { supabase.removeChannel(channel); };
  }, [session.id, user?.email]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-destructive/40 bg-destructive/5 overflow-hidden"
    >
      <div className="flex items-center gap-3 p-3">
        {/* Live indicator */}
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-destructive/15 flex items-center justify-center">
            <span className="font-bold text-sm text-destructive">
              {handle.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <span className="absolute -bottom-0.5 -end-0.5 flex w-3.5 h-3.5">
            <span className="absolute inline-flex w-full h-full rounded-full bg-destructive opacity-60 animate-ping" />
            <span className="relative inline-flex w-3.5 h-3.5 rounded-full bg-destructive" />
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onViewProfile?.({ id: session.host_user_id, email: session.host_email })}
              className="text-sm font-bold hover:underline"
            >
              @{handle}
            </button>
            <span className="text-micro font-bold uppercase tracking-wider text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
              🔴 LIVE
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {session.title || 'Live Workout'}
          </p>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Users className="w-3 h-3" />
          <span>{viewers}</span>
        </div>
      </div>

      {/* Live activity bar */}
      {liveData.exercise && (
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex-1 flex items-center gap-2 bg-secondary/60 rounded-lg px-3 py-2">
            <Dumbbell className="w-3.5 h-3.5 text-destructive shrink-0" />
            <span className="text-xs font-medium text-foreground truncate">{liveData.exercise}</span>
            {liveData.set && (
              <span className="text-micro text-muted-foreground shrink-0">
                Set {liveData.set}{liveData.reps ? ` · ${liveData.reps} reps` : ''}
              </span>
            )}
          </div>
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="absolute inline-flex w-full h-full rounded-full bg-success opacity-75 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
          </span>
        </div>
      )}
    </motion.div>
  );
}
