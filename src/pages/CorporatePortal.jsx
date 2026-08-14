// src/pages/CorporatePortal.jsx
//
// Corporate Wellness Portal (/corporate). Three states:
//   • No org      → create an organization OR join one by code.
//   • Member view → org challenges + a "share code" prompt.
//   • Admin view  → all of the above + a read-only HR analytics card
//                   (aggregate engagement only; never per-employee).
//
// Built on the org tenant tables in migration 146.

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, Loader2, Users, TrendingUp, Flame, Activity,
  Copy, Trash2, Lock, LogOut, Trophy, ArrowLeft, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import EmptyState from '@/components/EmptyState';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  listMyOrganizations, createOrganization, joinOrganizationByCode, leaveOrganization,
  listChallenges, createChallenge, deleteChallenge, getOrgAnalytics, getMemberCount,
} from '@/lib/data/organizations';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

const METRICS = [
  { id: 'workouts',    label: 'Total workouts' },
  { id: 'active_days', label: 'Active days' },
  { id: 'volume',      label: 'Volume lifted' },
  { id: 'streak',      label: 'Streak days' },
  { id: 'hydration',   label: 'Hydration' },
];

export default function CorporatePortal() {
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  // Synchronous double-tap guards. The `busy` state lags React renders,
  // so a fast second tap before the next paint slips through and fires
  // a second RPC. Pattern: useRef(false) set/cleared inside the click
  // handler itself. Same defect class as Waves 47-51.
  const createRef = useRef(false);
  const joinRef = useRef(false);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['myOrganizations', user?.id],
    queryFn: () => listMyOrganizations(user.id),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const activeOrg = orgs.find(o => o.id === selectedId) || orgs[0] || null;
  const isAdmin = activeOrg?.role === 'admin';

  const refresh = () => qc.invalidateQueries({ queryKey: ['myOrganizations', user?.id] });

  const handleCreate = async () => {
    if (busy || createRef.current || !orgName.trim()) return;
    createRef.current = true;
    setBusy(true);
    const res = await createOrganization(orgName);
    setBusy(false);
    createRef.current = false;
    if (res.ok) {
      toast.success(`Created — share code ${res.join_code} with your team.`);
      setOrgName(''); setCreating(false); setSelectedId(res.org_id);
      refresh();
    } else if (res.error === 'PIPELINE_MISSING') {
      toast.error('Corporate features are rolling out — try again shortly.');
    } else {
      toast.error('Could not create organization.');
    }
  };

  const handleJoin = async () => {
    // Codes are exactly 8 characters (mig 146's mint loop produces 8-char
    // codes from the unambiguous alphabet). Previously the gate was
    // length >= 4, so "ABCD" or "ABCDE" would submit, hit the server,
    // and bounce with a generic CODE_NOT_FOUND — looked like a bug to
    // users who fat-fingered a partial paste. (Audit 12 #25.)
    const cleaned = joinCode.trim().toUpperCase();
    if (busy || joinRef.current || cleaned.length !== 8) return;
    joinRef.current = true;
    setBusy(true);
    const res = await joinOrganizationByCode(cleaned);
    setBusy(false);
    joinRef.current = false;
    if (res.ok) {
      toast.success('Joined your organization.');
      setJoinCode(''); setSelectedId(res.org_id);
      refresh();
    } else {
      const map = { CODE_NOT_FOUND: 'No organization matches that code.', SEATS_FULL: 'This organization is at its seat limit.' };
      toast.error(map[res.error] || "Couldn't join — try again.");
    }
  };

  const handleLeave = async () => {
    if (!activeOrg) return;
    // Last-admin guard. The CASCADE on the FK + RLS happily let the
    // sole admin DELETE their membership row, orphaning every other
    // member of the org with no path back to admin. We block the
    // self-leave for sole admins with a clear path forward: transfer
    // (TBD product decision) or delete the entire org instead.
    // (Audit 12 #23.)
    if (isAdmin) {
      try {
        const { data, error } = await supabase
          .from('organization_members')
          .select('user_id', { count: 'exact', head: false })
          .eq('org_id', activeOrg.id)
          .eq('role', 'admin');
        const adminCount = error ? null : (data || []).length;
        if (adminCount === 1) {
          toast.error(
            'You are the only admin. Promote another member first, or delete the organization in Settings.'
          );
          return;
        }
      } catch {
        // Network failure on the guard — fall through to the delete
        // attempt; the RPC/RLS will still cascade-protect data even
        // if our guard couldn't confirm.
      }
    }
    if (!confirm(`Leave ${activeOrg.name}?`)) return;
    const res = await leaveOrganization(activeOrg.id, user.id);
    if (res.ok) { toast.success('Left organization.'); setSelectedId(null); refresh(); }
    else toast.error("Couldn't leave — try again.");
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto p-4 pb-24">
      <button type="button" onClick={() => navigate('/dashboard')} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground mb-3">
        <ArrowLeft className="w-4 h-4" /> {tFallback("dashboard.title", "Dashboard")}
      </button>

      <div className="mb-4">
        <h1 className="font-heading text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" /> {tFallback("app.corporateWellness", "Corporate Wellness")}
        </h1>
        <p className="text-sm text-muted-foreground">Private team challenges + aggregate engagement insights.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : orgs.length === 0 ? (
        // ── No org: create or join ──────────────────────────────────
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold mb-1">{tFallback("corporatePortal.joinYourCompany", "Join your company")}</p>
            <p className="text-xs text-muted-foreground mb-3">Enter the code your wellness admin shared.</p>
            <div className="flex gap-2">
              <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                placeholder={tFallback("corporatePortal.orgCode", "ORG CODE")} className="font-mono tracking-[0.2em] text-center uppercase" maxLength={8} />
              <Button onClick={handleJoin} disabled={busy || joinCode.trim().length !== 8}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join'}
              </Button>
            </div>
          </div>
          {creating ? (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-semibold mb-2">{tFallback("corporatePortal.newOrganization", "New organization")}</p>
              <Input value={orgName} onChange={(e) => setOrgName(e.target.value.slice(0, 80))} placeholder="Acme Inc. Wellness" className="mb-2" />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCreating(false)} className="flex-1">{tFallback("coach.plan.cancel", "Cancel")}</Button>
                <Button onClick={handleCreate} disabled={busy || !orgName.trim()} className="flex-1">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Building2}
              title={tFallback("corporatePortal.runWellnessForYourTeam", "Run wellness for your team")}
              body="Create an organization, share the join code with employees, launch private challenges, and track aggregate engagement — without seeing any individual's data."
              action={{ label: 'Create organization', onClick: () => setCreating(true) }}
            />
          )}
        </div>
      ) : (
        // ── In an org ────────────────────────────────────────────────
        <>
          {orgs.length > 1 && (
            <div className="flex gap-1 mb-3 overflow-x-auto">
              {orgs.map(o => (
                <button key={o.id} onClick={() => setSelectedId(o.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                    activeOrg?.id === o.id ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}>
                  {o.name}
                </button>
              ))}
            </div>
          )}

          {activeOrg && (
            <ErrorBoundary label="OrgHub">
              <OrgHub org={activeOrg} isAdmin={isAdmin} onLeave={handleLeave}
                onNewChallenge={() => setChallengeOpen(true)} />
            </ErrorBoundary>
          )}

          {challengeOpen && (
            <ErrorBoundary label="ChallengeFormModal">
              <ChallengeFormModal
                orgId={activeOrg.id}
                onClose={() => setChallengeOpen(false)}
                onSaved={() => { setChallengeOpen(false); qc.invalidateQueries({ queryKey: ['orgChallenges', activeOrg.id] }); }}
              />
            </ErrorBoundary>
          )}
        </>
      )}
    </motion.div>
  );
}

// ── Org hub (header + analytics + challenges) ─────────────────────────
function OrgHub({ org, isAdmin, onLeave, onNewChallenge }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const { data: memberCount = 0 } = useQuery({
    queryKey: ['orgMemberCount', org.id],
    queryFn: () => getMemberCount(org.id),
    staleTime: 30_000,
  });
  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ['orgChallenges', org.id],
    queryFn: () => listChallenges(org.id),
    staleTime: 30_000,
  });
  const { data: analytics } = useQuery({
    queryKey: ['orgAnalytics', org.id],
    queryFn: () => getOrgAnalytics(org.id),
    enabled: isAdmin,
    staleTime: 30_000,
  });

  // Persistent "show code" modal — opened when the clipboard API is
  // unavailable (insecure context, iframe) so the user can manually
  // select + copy the code instead of seeing it flash by in an
  // auto-dismissing toast. (Audit 12 #24.)
  const [showCodeOpen, setShowCodeOpen] = useState(false);
  const copyCode = async () => {
    if (!navigator?.clipboard?.writeText) {
      setShowCodeOpen(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(org.join_code);
      toast.success('Join code copied.');
    } catch {
      setShowCodeOpen(true);
    }
  };

  const handleDeleteChallenge = async (id) => {
    if (!confirm(tFallback("corporatePortal.deleteThisChallenge", "Delete this challenge?"))) return;
    const res = await deleteChallenge(id);
    if (res.ok) qc.invalidateQueries({ queryKey: ['orgChallenges', org.id] });
    else toast.error("Couldn't delete.");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-xl font-bold truncate">{org.name}</h2>
              {isAdmin && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-300 border border-amber-400/30 font-bold uppercase tracking-wide text-micro">
                  <Crown className="w-2.5 h-2.5" /> {tFallback("crewMessageItem.admin", "Admin")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <Users className="w-3 h-3" /> {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onLeave} className="gap-1.5 text-muted-foreground hover:text-destructive active:text-destructive shrink-0">
            <LogOut className="w-3.5 h-3.5" /> {tFallback("corporatePortal.leave", "Leave")}
          </Button>
        </div>
        {isAdmin && (
          <button onClick={copyCode} className="mt-3 w-full rounded-xl bg-primary/10 border border-primary/20 p-2.5 flex items-center justify-between hover:bg-primary/10 active:bg-primary/10 transition-colors">
            <div className="text-start">
              <p className="text-micro font-bold uppercase tracking-wider text-primary">{tFallback("corporatePortal.teamJoinCode", "Team join code")}</p>
              <p className="font-mono text-lg tracking-[0.3em] font-bold">{org.join_code}</p>
            </div>
            <Copy className="w-4 h-4 text-primary" />
          </button>
        )}
        <Dialog open={showCodeOpen} onOpenChange={setShowCodeOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{tFallback("corporatePortal.teamJoinCode", "Team join code")}</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Clipboard access isn't available here. Press and hold to copy the code:
            </p>
            <input
              readOnly
              value={org.join_code}
              onFocus={(e) => e.target.select()}
              className="mt-3 w-full font-mono text-xl tracking-[0.3em] font-bold text-center bg-secondary/50 border border-border rounded-lg py-3 px-2 select-all"
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* HR analytics — admin only, aggregate only */}
      {isAdmin && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <h3 className="font-heading font-bold text-sm">Engagement (read-only)</h3>
            <span className="ms-auto inline-flex items-center gap-1 text-micro text-muted-foreground">
              <Lock className="w-3 h-3" /> aggregate only
            </span>
          </div>
          {!analytics ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
          ) : analytics.cohort_too_small ? (
            <p className="text-xs text-muted-foreground py-2">
              Need at least {analytics.min_cohort} members before engagement stats unlock — this protects individual privacy in small teams. ({analytics.members} member{analytics.members === 1 ? '' : 's'} so far.)
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Participation', value: `${analytics.participation_pct}%`, Icon: Activity, color: 'text-primary' },
                { label: 'Active (7d)', value: `${analytics.active_7d}/${analytics.members}`, Icon: Users, color: 'text-emerald-500' },
                { label: 'Workouts (7d)', value: analytics.workouts_7d, Icon: Trophy, color: 'text-amber-500' },
                { label: 'Avg streak', value: `${analytics.avg_workout_streak}d`, Icon: Flame, color: 'text-orange-500' },
              ].map(({ label, value, Icon, color }) => (
                <div key={label} className="rounded-xl bg-secondary/40 p-3 text-center">
                  <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                  <p className={`font-heading font-bold text-lg tabular-nums ${color}`}>{value}</p>
                  <p className="text-micro text-muted-foreground uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-micro text-muted-foreground mt-3">
            Individual employee data is never shown — only team aggregates.
          </p>
        </div>
      )}

      {/* Challenges */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-heading font-bold">{tFallback("corporatePortal.teamChallenges", "Team challenges")}</h3>
          {isAdmin && (
            <Button size="sm" onClick={onNewChallenge} className="gap-1.5">
              <Plus className="w-4 h-4" /> {tFallback("coach.onboarding.levelLabel.newbie", "New")}
            </Button>
          )}
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        ) : challenges.length === 0 ? (
          <EmptyState icon={Trophy} title={tFallback("corporatePortal.noChallengesYet", "No challenges yet")} body={isAdmin ? 'Launch a step, workout, or streak challenge for your team.' : 'Your admin hasn’t started a challenge yet.'} />
        ) : (
          <div className="space-y-2">
            {challenges.map(c => {
              const metric = METRICS.find(m => m.id === c.metric);
              // Treat the ends_at date in the user's LOCAL timezone:
              // a challenge "ending today" was previously shown as
              // ended at midnight UTC, which for users in negative
              // offsets flagged the challenge as over before their
              // day finished. Now we shift to end-of-local-day.
              // (Audit 12 #29.)
              const ended = (() => {
                if (!c.ends_at) return false;
                const endLocalEod = new Date(c.ends_at);
                if (!Number.isFinite(endLocalEod.getTime())) return false;
                // Only shift to EOD when the value is a date-only string;
                // a full ISO timestamp respects the embedded time.
                if (/^\d{4}-\d{2}-\d{2}$/.test(String(c.ends_at))) {
                  endLocalEod.setHours(23, 59, 59, 999);
                }
                return endLocalEod < new Date();
              })();
              return (
                <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-sm">{c.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {metric?.label || c.metric}{c.target_value > 0 ? ` · target ${c.target_value}` : ''}{ended ? ' · ended' : ''}
                      </p>
                    </div>
                    {isAdmin && (
                      <button onClick={() => handleDeleteChallenge(c.id)} className="w-7 h-7 rounded-full text-muted-foreground hover:text-destructive active:text-destructive flex items-center justify-center shrink-0" aria-label={tFallback("corporatePortal.deleteChallenge", "Delete challenge")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── New challenge modal ───────────────────────────────────────────────
function ChallengeFormModal({ orgId, onClose, onSaved }) {
  const { tFallback } = useLanguage();
  // Only mounted while open (see the `challengeOpen &&` gate at its call
  // site), so the lock runs for this component's whole lifetime.
  useBodyScrollLock();
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState('workouts');
  const [target, setTarget] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  // Synchronous double-tap guard — see CorporatePortal createRef.
  const saveRef = useRef(false);

  const save = async () => {
    if (saving || saveRef.current || !title.trim()) return;
    saveRef.current = true;
    setSaving(true);
    const res = await createChallenge(orgId, {
      title, metric, targetValue: target,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    });
    setSaving(false);
    saveRef.current = false;
    if (res.ok) { toast.success('Challenge launched.'); onSaved(); }
    else toast.error(res.error === 'PIPELINE_MISSING' ? 'Corporate features are rolling out — try again shortly.' : "Couldn't create challenge.");
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-4">
        <h2 className="font-heading font-bold text-lg mb-3">{tFallback("corporatePortal.newTeamChallenge", "New team challenge")}</h2>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder={tFallback("corporatePortal.octoberStepChallenge", "October Step Challenge")} />
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tFallback("corporatePortal.metric", "Metric")}</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value)} className="w-full mt-1 h-10 rounded-md border border-border bg-background px-2 text-sm">
              {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Target (optional)</label>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" placeholder="20" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ends (optional)</label>
              <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1">{tFallback("coach.plan.cancel", "Cancel")}</Button>
            <Button onClick={save} disabled={saving || !title.trim()} className="flex-1 gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Launch
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
