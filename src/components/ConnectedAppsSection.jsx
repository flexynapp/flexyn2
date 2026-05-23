// src/components/ConnectedAppsSection.jsx
//
// Placeholder section in Settings showing the integrations roadmap.
// Each card is currently disabled with "Coming soon" — the real OAuth
// flows (Strava, Apple Health, Google Fit) are slated for a later
// wave when we have the licensing + Capacitor wrapper sorted.
//
// Why ship the placeholder now? Two reasons:
//   1. Sets user expectation that integrations are coming.
//   2. When OAuth is wired up the surface to mount it already exists.

import React from 'react';
import { Plug, Activity, Apple, Watch } from 'lucide-react';

const APPS = [
  {
    id:    'apple_health',
    name:  'Apple Health',
    icon:  Apple,
    blurb: 'Sync workouts, sleep, and HRV.',
    status: 'coming_soon',
  },
  {
    id:    'google_fit',
    name:  'Google Fit',
    icon:  Activity,
    blurb: 'Pull steps, runs, and weight.',
    status: 'coming_soon',
  },
  {
    id:    'strava',
    name:  'Strava',
    icon:  Watch,
    blurb: 'Import runs + rides as cardio sessions.',
    status: 'coming_soon',
  },
];

export default function ConnectedAppsSection() {
  return (
    <div className="border-t border-border pt-3 mt-1">
      <div className="flex items-center gap-2 mb-2">
        <Plug className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Connected apps</h3>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">
        Wearable + health integrations. Coming soon — we'll let you know.
      </p>
      <ul className="space-y-1.5">
        {APPS.map(app => {
          const Icon = app.icon;
          return (
            <li key={app.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-secondary/30">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-7 h-7 rounded-md bg-secondary flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{app.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{app.blurb}</p>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                Soon
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
