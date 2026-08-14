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
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Check, Trash2, X, ChevronLeft, AlertTriangle, Bug, Apple, ScanBarcode } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminRoles';
import {
  listReports, resolveReport, deleteReportedContent,
  listBugReports, resolveBugReport,
  listFoodItemRequests, approveFoodItemRequest, rejectFoodItemRequest,
} from '@/lib/data/admin';
import { errorToast } from '@/lib/errorToast';
import { reportError } from '@/lib/reportError';
import PageHeader from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/lib/LanguageContext';

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

// Food requests use their own vocabulary because the outcome is different in
// kind: approving one WRITES A ROW into the shared catalogue that every future
// scan reads. "Reviewed" would be a lie — nothing was published — so the
// states are pending → approved / rejected, matching migration 343's CHECK.
const FOOD_TABS = [
  { id: 'pending',  label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
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
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reportKind, setReportKind] = useState('content'); // 'content' | 'bug' | 'food'
  const [activeTab, setActiveTab] = useState('pending');
  const isAdmin = isAppAdmin(user);
  const isBug  = reportKind === 'bug';
  const isFood = reportKind === 'food';
  const TABS = isFood ? FOOD_TABS : isBug ? BUG_TABS : CONTENT_TABS;

  // Hooks must run on every render — the !isAdmin early-return is
  // placed AFTER all hooks below to honor the rules-of-hooks.
  const { data: reports = [], isLoading, refetch } = useQuery({
    // Kind and tab are both in the key, so every tab press dropped the list
    // to three skeletons and rebuilt it. Same fix as the other boards.
    placeholderData: keepPreviousData,
    queryKey: ['adminReports', reportKind, activeTab],
    queryFn:  () => isFood
      ? listFoodItemRequests({ status: activeTab })
      : isBug
        ? listBugReports({ status: activeTab })
        : listReports({ status: activeTab }),
    enabled:  !!user?.id && isAdmin,
    staleTime: 15_000,
  });

  // Approving is the only action on this page that PUBLISHES something —
  // it writes a food_items row every future barcode scan will read. The
  // success toast names the food rather than saying "approved", so a
  // misclick on the wrong row is obvious immediately.
  const foodApproveMut = useMutation({
    mutationFn: ({ id }) => approveFoodItemRequest(id),
    onSuccess: (_d, { name }) => {
      toast.success(`“${name}” is in the food database.`);
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
    },
    onError: (err, vars) => {
      // 22023 is the RPC refusing to approve an already-reviewed request —
      // two admins on the queue at once, or a double tap. That is not a
      // failure worth a retry button; the row is already handled.
      if (err?.code === '22023') {
        toast.message('Already handled by someone else.');
        queryClient.invalidateQueries({ queryKey: ['adminReports'] });
        return;
      }
      reportError(err, { feature: 'admin.foodRequests.approve', userEmail: user?.email });
      errorToast({
        title: 'Could not approve this food',
        description: err?.message,
        retry: () => foodApproveMut.mutate(vars),
      });
    },
  });

  const foodRejectMut = useMutation({
    mutationFn: ({ id }) => rejectFoodItemRequest(id),
    onSuccess: () => {
      toast.success('Request rejected. Nothing was published.');
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
    },
    onError: (err, vars) => {
      reportError(err, { feature: 'admin.foodRequests.reject', userEmail: user?.email });
      errorToast({
        title: 'Could not reject this request',
        description: err?.message,
        retry: () => foodRejectMut.mutate(vars),
      });
    },
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
        <h1 className="font-heading font-bold text-lg">{tFallback("adminReports.adminOnly", "Admin only")}</h1>
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
        title={tFallback("adminReports.reportQueue", "Report queue")}
        icon={ShieldAlert}
        hidePeriod
      />

      {/* Kind switch — content reports vs user bug reports (mig 144). */}
      <div className="flex gap-1 mb-4 rounded-lg bg-secondary/50 p-1 w-fit">
        {[
          { id: 'content', label: 'Content', Icon: ShieldAlert },
          { id: 'bug',     label: 'Bug reports', Icon: Bug },
          { id: 'food',    label: 'Food requests', Icon: Apple },
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
          <p className="font-heading font-bold text-base">No {activeTab} {isFood ? 'requests' : 'reports'}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTab === 'pending' ? 'Inbox zero. Nicely done.' : 'Nothing to show here.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence>
            {isFood
              ? reports.map(r => (
                  <FoodRequestRow
                    key={r.id}
                    request={r}
                    isPending={activeTab === 'pending'}
                    busy={foodApproveMut.isPending || foodRejectMut.isPending}
                    onApprove={() => foodApproveMut.mutate({ id: r.id, name: r.name })}
                    onReject={() => foodRejectMut.mutate({ id: r.id })}
                  />
                ))
              : isBug
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
        Showing up to 50 reports. <button onClick={() => refetch()} className="underline">{tFallback("adminReports.refresh", "Refresh")}</button>
      </div>
    </motion.div>
  );
}

function ReportRow({ report, isPending, busy, onResolve, onDelete }) {
  const { tFallback } = useLanguage();
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

// The whole point of this queue is that a human reads the label before it
// becomes the number every future scan of that barcode returns. So the row
// shows the FULL nutrition payload, not a summary — an approver who cannot
// see that the protein figure is 200 g cannot catch it.
const MACRO_ORDER = [
  ['calories', 'kcal'], ['protein', 'g'], ['carbs', 'g'], ['fat', 'g'],
  ['fiber', 'g'], ['sugar', 'g'], ['sodium', 'mg'], ['cholesterol', 'mg'],
];

function FoodRequestRow({ request, isPending, busy, onApprove, onReject }) {
  const { tFallback } = useLanguage();
  const n = request.nutrition && typeof request.nutrition === 'object' ? request.nutrition : {};
  const v = request.vitamins && typeof request.vitamins === 'object' ? request.vitamins : {};
  const macros = MACRO_ORDER.filter(([k]) => n[k] != null);
  // Only the micros that were actually filled in — a column of nulls tells
  // the reviewer nothing and pushes the buttons off screen.
  const micros = Object.entries(v).filter(([, val]) => val != null && val !== 0);

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="border border-border rounded-xl p-4 bg-card"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
          <Apple className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-sm break-words">{request.name}</p>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {request.brand && (
              <span className="text-micro font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary">
                {request.brand}
              </span>
            )}
            {request.serving_label && (
              <span className="text-xs text-muted-foreground">{request.serving_label}</span>
            )}
          </div>
          {request.barcode && (
            <span className="inline-flex items-center gap-1 text-micro font-mono mt-1.5 px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
              <ScanBarcode className="w-3 h-3" /> {request.barcode}
            </span>
          )}
        </div>
      </div>

      {macros.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {macros.map(([k, unit]) => (
            <span key={k} className="text-micro px-1.5 py-0.5 rounded bg-secondary/60 tabular-nums">
              <span className="text-muted-foreground capitalize">{k} </span>
              <span className="font-bold">{n[k]}{unit}</span>
            </span>
          ))}
        </div>
      )}

      {micros.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {micros.map(([k, val]) => {
            // Keys are `<name>_<unit>` (iron_mg, vitamin_b12_mcg,
            // vitamin_a_iu). Rendering the raw key gave "iron mg 1", which
            // reads as a quantity of milligrams called iron. Split the unit
            // off so the number carries it: "iron 1 mg".
            const cut = k.lastIndexOf('_');
            const label = cut > 0 ? k.slice(0, cut).replace(/_/g, ' ') : k;
            const unit  = cut > 0 ? k.slice(cut + 1).replace('iu', 'IU') : '';
            return (
              <span key={k} className="text-micro px-1.5 py-0.5 rounded bg-secondary/30 tabular-nums text-muted-foreground">
                {label} <span className="font-bold text-foreground">{val}{unit}</span>
              </span>
            );
          })}
        </div>
      )}

      {request.note && (
        <p className="text-sm text-foreground mt-2 whitespace-pre-wrap break-words">{request.note}</p>
      )}

      <p className="text-micro text-muted-foreground mt-2">
        {request.requester_email || 'anonymous'}
      </p>

      {isPending && (
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => {
              // Approving publishes to every user, so it is confirmed and the
              // other two actions on this page are not. Naming the food in the
              // prompt is what makes a misclick catchable.
              if (confirm(`Publish “${request.name}” to the shared food database? Everyone who scans this barcode will get these numbers.`)) onApprove();
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 active:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Approve &amp; publish
          </button>
          <button
            onClick={() => onReject()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-muted-foreground text-xs font-medium hover:text-foreground active:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" /> Reject
          </button>
        </div>
      )}
    </motion.li>
  );
}

function BugReportRow({ report, isPending, busy, onResolve }) {
  const { tFallback } = useLanguage();
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
