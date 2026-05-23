// src/pages/MyGyms.jsx
//
// User's "My Gyms" dashboard. Lists every gym the user has joined,
// plus the two entry points to add a new one:
//   1. "Join by code" — type/scan the 8-char Flexyn Code printed
//      inside the gym
//   2. "Browse map" — opens the national map (/gym-map) for discovery
//
// Empty state is the most common case for v1 — explain the value +
// CTA into both add paths.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, MapPin, Loader2, Building2, QrCode, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import { listMyGyms, joinByCode } from '@/lib/data/gymBusinesses';

export default function MyGyms() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [gyms, setGyms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [joining, setJoining] = useState(false);

  const refresh = async () => {
    if (!user?.id) return;
    setLoading(true);
    const rows = await listMyGyms(user.id);
    setGyms(rows);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [user?.id]);

  const handleJoin = async (e) => {
    e?.preventDefault?.();
    if (joining) return;
    setJoining(true);
    const res = await joinByCode(codeInput);
    setJoining(false);
    if (res.ok) {
      if (res.alreadyMember) toast.info("You're already a member of this gym.");
      else toast.success('Joined! Welcome to the local community.');
      setCodeInput('');
      refresh();
      // Auto-open the gym hub for immediate context
      if (res.gymId) navigate(`/gym/${res.gymId}`);
    } else {
      const map = {
        INVALID_CODE: 'That code doesn\'t look right (8 letters/numbers).',
        CODE_NOT_FOUND: 'No gym matches that code.',
        PIPELINE_MISSING: 'Gym features are rolling out — try again shortly.',
      };
      toast.error(map[res.error] || `Couldn't join: ${res.error || 'try again'}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">My Gyms</h1>
          <p className="text-sm text-muted-foreground">Every Flexyn gym you've joined.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/gym-map')}
          className="gap-1.5"
        >
          <MapPin className="w-3.5 h-3.5" /> Browse map
        </Button>
      </div>

      {/* Code entry */}
      <form onSubmit={handleJoin} className="rounded-2xl border border-border bg-card p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <QrCode className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold">Join by code</p>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Enter the 8-character Flexyn Code printed inside the gym.
        </p>
        <div className="flex gap-2">
          <Input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8))}
            placeholder="ABCD2345"
            maxLength={8}
            className="font-mono tracking-[0.3em] text-center text-lg uppercase"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={joining || codeInput.length !== 8}>
            {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </form>

      {/* Joined gym list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : gyms.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No gyms joined yet"
          body="Scan the QR code or type the Flexyn Code at your gym to join its community, or browse the map to find one near you."
          action={{ label: 'Browse map', onClick: () => navigate('/gym-map') }}
        />
      ) : (
        <div className="space-y-2">
          {gyms.map(g => (
            <motion.button
              key={g.id}
              type="button"
              onClick={() => navigate(`/gym/${g.id}`)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.99 }}
              className="w-full text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  {g.logo_url
                    ? <img src={g.logo_url} alt="" className="w-full h-full rounded-xl object-cover" />
                    : <Building2 className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{g.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[g.city, g.state_code].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="w-3 h-3" />
                    <span className="tabular-nums">{g.member_count ?? 0}</span>
                  </p>
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
