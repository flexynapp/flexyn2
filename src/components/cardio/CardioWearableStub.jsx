// src/components/cardio/CardioWearableStub.jsx
//
// Wearable + health platform integration hub.
// Shows connection status for Apple Watch, Garmin, Polar, Fitbit,
// Apple Health, and Google Fit.
//
// NOTE: Actual OAuth / native SDK sync requires platform-specific
// setup (Garmin Connect IQ OAuth, Apple HealthKit via Capacitor/React
// Native, etc.). These are UI stubs with connection flow scaffolding.
// Wire up real tokens + sync RPCs when native SDK is available.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link2, Link2Off, Loader2, Smartphone, Watch } from 'lucide-react';
import { toast } from '@/lib/toast';

const WEARABLES = [
  {
    id: 'apple_watch',
    name: 'Apple Watch',
    subtitle: 'via Apple Health (iOS only)',
    logo: '⌚',
    color: 'bg-zinc-900 text-white',
    available: typeof window !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent),
    unavailableReason: 'Requires iOS app',
  },
  {
    id: 'garmin',
    name: 'Garmin Connect',
    subtitle: 'Sync runs, rides & HR data',
    logo: '🟦',
    color: 'bg-blue-600 text-white',
    available: true,
    unavailableReason: null,
  },
  {
    id: 'polar',
    name: 'Polar Flow',
    subtitle: 'Heart rate & training load',
    logo: '🔴',
    color: 'bg-red-600 text-white',
    available: true,
    unavailableReason: null,
  },
  {
    id: 'fitbit',
    name: 'Fitbit / Google Fit',
    subtitle: 'Steps, sleep & active calories',
    logo: '🟢',
    color: 'bg-teal-500 text-white',
    available: true,
    unavailableReason: null,
  },
];

const HEALTH_PLATFORMS = [
  {
    id: 'apple_health',
    name: 'Apple Health',
    subtitle: 'Steps, active calories, resting HR',
    logo: '❤️',
    available: typeof window !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent),
    unavailableReason: 'Requires iOS app',
  },
  {
    id: 'google_fit',
    name: 'Google Fit',
    subtitle: 'Steps, workouts & heart points',
    logo: '💚',
    available: typeof window !== 'undefined' && /Android/.test(navigator.userAgent),
    unavailableReason: 'Requires Android app',
  },
];

function IntegrationCard({ item, connected, onConnect, onDisconnect, connecting }) {
  const isConnecting = connecting === item.id;
  const unavailable = !item.available;

  return (
    <Card className={`overflow-hidden ${connected ? 'border-green-500/40 bg-green-500/5' : ''} ${unavailable ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-4 p-4">
        <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center text-2xl shrink-0">
          {item.logo}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{item.name}</p>
          <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
          {unavailable && item.unavailableReason && (
            <p className="text-micro text-amber-500 mt-0.5">{item.unavailableReason}</p>
          )}
          {connected && (
            <p className="text-micro text-green-500 mt-0.5 font-medium">✓ Connected</p>
          )}
        </div>
        <div className="shrink-0">
          {connected ? (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 active:bg-destructive/10"
              onClick={() => onDisconnect(item.id)}
              disabled={isConnecting || unavailable}
            >
              <Link2Off className="w-3 h-3 me-1" />
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onConnect(item.id)}
              disabled={isConnecting || unavailable}
            >
              {isConnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Link2 className="w-3 h-3 me-1" />
                  Connect
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function CardioWearableStub() {
  const [connected, setConnected] = useState({});
  const [connecting, setConnecting] = useState(null);

  const handleConnect = async (id) => {
    setConnecting(id);
    // Stub: simulate OAuth redirect/response delay
    await new Promise(r => setTimeout(r, 1500));
    setConnecting(null);
    // In production: redirect to OAuth, receive token, store in user_profile or secrets
    toast.info(
      `${WEARABLES.concat(HEALTH_PLATFORMS).find(w => w.id === id)?.name} integration coming soon`,
      {
        description: 'Native app sync support is on our roadmap. Stay tuned!',
        duration: 5000,
      }
    );
  };

  const handleDisconnect = (id) => {
    setConnected(prev => ({ ...prev, [id]: false }));
    toast.success('Disconnected');
  };

  return (
    <div className="space-y-6">
      {/* Wearables */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Watch className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Wearable Devices</p>
        </div>
        {WEARABLES.map(w => (
          <motion.div
            key={w.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <IntegrationCard
              item={w}
              connected={!!connected[w.id]}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              connecting={connecting}
            />
          </motion.div>
        ))}
      </div>

      {/* Health Platforms */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Smartphone className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Health Platforms</p>
        </div>
        {HEALTH_PLATFORMS.map(p => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <IntegrationCard
              item={p}
              connected={!!connected[p.id]}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              connecting={connecting}
            />
          </motion.div>
        ))}
      </div>

      <p className="text-xs text-center text-muted-foreground/60 pt-2">
        Full wearable sync requires the Flexyn mobile app. Web support coming Q3 2026.
      </p>
    </div>
  );
}
