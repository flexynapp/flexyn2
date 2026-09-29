import { ChevronRight } from 'lucide-react';

// One grouped list for everything that has its own page: league, rival,
// crew war, workouts, trophies, posts. It replaced a tab strip, a row of
// glass pills on the cover and four stacked cards, so the profile reads as a
// summary with one tap to each detail, the way a settings or health summary
// does on iOS. A row renders as a button only when it goes somewhere.
export function SummaryRow({ icon: Icon, label, sub, value, onClick }) {
  const body = (
    <>
      <Icon className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0 flex flex-col text-start">
        <span className="text-sm font-semibold">{label}</span>
        {sub && <span className="text-xs text-muted-foreground truncate">{sub}</span>}
      </span>
      {value != null && (
        <span className="text-sm text-muted-foreground tabular-nums shrink-0">{value}</span>
      )}
      {onClick && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />}
    </>
  );
  const cls = 'w-full flex items-center gap-3 px-4 py-2.5 min-h-[52px]';
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} hover:bg-secondary/60 active:bg-secondary/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary`}
    >
      {body}
    </button>
  );
}

export default function ProfileSummaryList({ children }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
      {children}
    </div>
  );
}
