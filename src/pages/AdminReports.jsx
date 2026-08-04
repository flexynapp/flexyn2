// src/pages/AdminReports.jsx
//
// Moderator-only view of the hub_reports queue. Gated client-side via
// isAppAdmin() and server-side via the is_app_admin() RPC inside each
// admin function — non-admins get a permission error from the RPC even
// if they bypass the React gate.
//
// Three tabs:
//   • Pending — newly filed reports awaiting review
//   • Reviewed — ack'd but not actioned (kept for audit)
//   • Actioned/Dismissed — closed reports
//
// Three actions per pending row:
//   • Mark reviewed — file the report as audited, leave content alone
//   • Delete content — soft-deletes the offending post/comment
//   • Dismiss — closes the report without action
//
// Each action posts a sonner toast on success / errorToast on failure
// (which auto-retries the same RPC on tap).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Check, Trash2, X, ChevronLeft, AlertTriangle, Bug } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminRoles';
import { listReports, resolveReport, deleteReportedContent, listBugReports, resolveBugReport } from '@/lib/data/admin';
import { errorToast } from '@/lib/errorToast';
import { reportError } from '@/lib/reportError';
import PageHeader from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

const CONTENT_TABS = [
  { id: 'pending',   label: 'Pending' },
  { id: 'reviewed',  label: 'Reviewed' },
  { id: 'actioned',  label: 'Actioned' },
  { id: 'dismissed', label: 'Dismissed' },
];

// Bug reports have no "actioned" state (no content to delete) — just
// pending → reviewed / dismissed.
const BUG_TABS = [
  { id: 'pending',   label: 'Pending' },
  { id: 'reviewed',  label: 'Reviewed' },
  { id: 'dismissed', label: 'Dismissed' },
];

const REASON_LABEL = {
  harassment:    'Harassment',
  hate_speech:   'Hate speech',
  spam:          'Spam',
  inappropriate: 'Inappropriate',
  impersonation: 'Impersonation',
  other:         'Other',
};

export default function AdminReports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reportKind, setReportKind] = useState('content'); // 'content' | 'bug'
  const [activeTab, setActiveTab] = useState('pending');
  const isAdmin = isAppAdmin(user);
  const isBug = reportKind === 'bug';
  const TABS = isBug ? BUG_TABS : CONTENT_TABS;

  // Hooks must run on every render — the !isAdmin early-return is
  // placed AFTER all hooks below to honor the rules-of-hooks.
  const { data: reports = [], isLoading, refetch } = useQuery({
    queryKey: ['adminReports', reportKind, activeTab],
    queryFn:  () => isBug
      ? listBugReports({ status: activeTab })
      : listReports({ status: activeTab }),
    enabled:  !!user?.id && isAdmin,
    staleTime: 15_000,
  });

  const bugResolveMut = useMutation({
    mutationFn: ({ id, status }) => resolveBugReport(id, status),
    onSuccess: (_d, { status }) => {
      toast.success(`Bug report ${status}.`);
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
    },
    onError: (err, vars) => {
      reportError(err, { feature: 'admin.bugReports.resolve', userEmail: user?.email });
      errorToast({
        title: 'Could not update bug report',
        description: err?.message,
        retry: () => bugResolveMut.mutate(vars),
      });
    },
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, action }) => resolveReport(id, action),
    onSuccess: (_d, { action }) => {
      toast.success(`Report ${action}.`);
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
    },
    onError: (err, vars) => {
      reportError(err, { feature: 'admin.reports.resolve', userEmail: user?.email });
      errorToast({
        title: 'Could not update report',
        description: err?.message,
        retry: () => resolveMut.mutate(vars),
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: ({ id }) => deleteReportedContent(id),
    onSuccess: () => {
      toast.success('Content removed and report actioned.');
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
    },
    onError: (err, vars) => {
      reportError(err, { feature: 'admin.reports.delete', userEmail: user?.email });
      errorToast({
        title: 'Could not delete content',
        description: err?.message,
        retry: () => deleteMut.mutate(vars),
      });
    },
  });

  // Client-side gate. Server-side gate is enforced inside every RPC
  // for defense in depth — bypassing this only gets you a 42501.
  if (!isAdmin) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h1 className="font-heading font-bold text-lg">Admin only</h1>
        <p className="text-sm text-muted-foreground mt-2">
          This page is restricted to app moderators.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="p-4 md:p-8 max-w-3xl mx-auto"
    >
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors mb-3"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <PageHeader
        kicker="Moderation"
        title="Report queue"
        icon={ShieldAlert}
        hidePeriod
      />

      {/* Kind switch — content reports vs user bug reports (mig 144). */}
      <div className="flex gap-1 mb-4 rounded-lg bg-secondary/50 p-1 w-fit">
        {[
          { id: 'content', label: 'Content', Icon: ShieldAlert },
          { id: 'bug',     label: 'Bug reports', Icon: Bug },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => { setReportKind(id); setActiveTab('pending'); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
              reportKind === id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground active:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border mb-4 -mx-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative px-3 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
              activeTab === tab.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground active:text-foreground'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <motion.span
                layoutId="admin-tab-underline"
                className="absolute -bottom-px start-0 end-0 h-0.5 bg-primary"
              />
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16">
          <Check className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
          <p className="font-heading font-bold text-base">No {activeTab} reports</p>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTab === 'pending' ? 'Inbox zero. Nicely done.' : 'Nothing to show here.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence>
            {isBug
              ? reports.map(r => (
                  <BugReportRow
                    key={r.id}
                    report={r}
                    isPending={activeTab === 'pending'}
                    busy={bugResolveMut.isPending}
                    onResolve={(status) => bugResolveMut.mutate({ id: r.id, status })}
                  />
                ))
              : reports.map(r => (
                  <ReportRow
                    key={r.id}
                    report={r}
                    isPending={activeTab === 'pending'}
                    busy={resolveMut.isPending || deleteMut.isPending}
                    onResolve={(action) => resolveMut.mutate({ id: r.id, action })}
                    onDelete={() => deleteMut.mutate({ id: r.id })}
                  />
                ))}
          </AnimatePresence>
        </ul>
      )}

      <div className="text-xs text-muted-foreground mt-6">
        Showing up to 50 reports. <button onClick={() => refetch()} className="underline">Refresh</button>
      </div>
    </motion.div>
  );
}

function ReportRow({ report, isPending, busy, onResolve, onDelete }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="border border-border rounded-xl p-4 bg-card"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-micro font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary">
              {report.reported_type}
            </span>
            <span className="text-micro font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">
              {REASON_LABEL[report.reason] || report.reason}
            </span>
            <span className="text-xs text-muted-foreground">
              by {report.reporter_email}
            </span>
          </div>
          {report.detail && (
            <p className="text-sm text-foreground mt-2">{report.detail}</p>
          )}
        </div>
      </div>

      {report.content_snippet ? (
        <div className="bg-secondary/40 border border-border/60 rounded-lg p-3 text-sm mb-3 whitespace-pre-wrap break-words">
          {report.content_snippet}
        </div>
      ) : (
        <div className="bg-secondary/40 border border-border/60 rounded-lg p-3 text-xs text-muted-foreground italic mb-3">
          (Content already removed or not accessible.)
        </div>
      )}

      {report.reported_author_email && (
        <p className="text-xs text-muted-foreground mb-3">
          Author: {report.reported_author_email}
        </p>
      )}

      {isPending && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              // Confirm before flipping the status — once moved out of
              // pending there's no UI path back to re-open. A misclick
              // shouldn't bury a report. (Audit 12 #6.)
              if (confirm('Mark this report as reviewed? It will leave the pending queue.')) onResolve('reviewed');
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Mark reviewed
          </button>
          <button
            onClick={() => {
              if (confirm('Delete this content? This cannot be undone.')) onDelete();
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete content
          </button>
          <button
            onClick={() => {
              if (confirm('Dismiss this report without action? It will leave the pending queue.')) onResolve('dismissed');
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-muted-foreground text-xs font-medium hover:text-foreground active:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" /> Dismiss
          </button>
        </div>
      )}
    </motion.li>
  );
}

function BugReportRow({ report, isPending, busy, onResolve }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="border border-border rounded-xl p-4 bg-card"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
          <Bug className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {report.reporter_email || 'anonymous'}
            </span>
            {report.page_context && (
              <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                {report.page_context}
              </span>
            )}
          </div>
          <p className="text-sm text-foreground mt-2 whitespace-pre-wrap break-words">{report.description}</p>
        </div>
      </div>

      {isPending && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onResolve('reviewed')}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Mark reviewed
          </button>
          <button
            onClick={() => onResolve('dismissed')}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-muted-foreground text-xs font-medium hover:text-foreground active:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" /> Dismiss
          </button>
        </div>
      )}
    </motion.li>
  );
}
