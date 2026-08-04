// src/components/NetworkStatusChip.jsx
//
// Small status chip that surfaces in the header when the device is
// offline (red/amber "Offline") or briefly when it reconnects ("Back
// online" green, fades out after 1.5s). Removes the
// "is-the-app-broken-or-is-my-wifi" anxiety which is one of the most
// universally annoying user experiences.
//
// Mounted in Layout's header so it's always visible without per-page
// wiring. Fade animations respect reduced-motion.

import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, Wifi } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export default function NetworkStatusChip() {
  const { online, justReconnected } = useNetworkStatus();
  // Show offline always while offline; show "back online" briefly after
  // reconnect, then hide. Online with no transition → render nothing.
  const showOffline = !online;
  const showReconnect = online && justReconnected;
  if (!showOffline && !showReconnect) return null;

  const isOffline = showOffline;
  const Icon = isOffline ? WifiOff : Wifi;
  const label = isOffline ? 'Offline' : 'Back online';
  const className = isOffline
    ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
    : 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30';

  return (
    <AnimatePresence>
      <motion.div
        key={isOffline ? 'offline' : 'reconnect'}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-micro font-semibold border ${className}`}
        role="status"
        aria-live="polite"
      >
        <Icon className="w-3 h-3" />
        <span>{label}</span>
      </motion.div>
    </AnimatePresence>
  );
}
