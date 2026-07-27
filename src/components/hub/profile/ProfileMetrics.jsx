// src/components/hub/profile/ProfileMetrics.jsx
//
// Posts / followers / following as one line of text.
//
// This replaces three bordered, filled, icon-topped tiles. The tiles gave
// each number a fill AND a border AND a radius to do work that whitespace
// and font-weight already do, then labelled them in 10px uppercase — a
// dashboard-widget idiom wearing a profile's clothes. Every reference
// implementation (Bluesky's Metrics.tsx, Ice Cubes' AccountStatsView,
// Voyager's Scores) renders counts as plain text and gets hierarchy from
// weight + colour alone.
//
// It also drops three concurrent 16ms setIntervals. The old Stat /
// AnimatedStatButton pair counted every number up from zero on mount —
// ~112 renders over 600ms, three timers per profile view, for an effect
// none of the reference apps bother with. Compact formatting is the better
// spend: a user with 2,300 followers reads "2.3K".
import { formatNumber } from '@/lib/intl';
import { pluralForm } from '@/lib/pluralize';

function Metric({ value, forms, onClick, language }) {
  // `?? 0` matters twice over: formatNumber returns '' for null/undefined,
  // which would render a bare noun with no number while a count query is
  // still in flight, and Intl.PluralRules needs a real number to pick a form.
  const count = value ?? 0;
  const formatted = formatNumber(count, language, { notation: 'compact', maximumFractionDigits: 1 });
  // pluralForm, not pluralize — pluralize bakes the count into the string,
  // so pairing it with a separate <span> for the number renders it twice.
  const noun = pluralForm(count, forms, language);

  const content = (
    <>
      <span className="font-bold tabular-nums">{formatted}</span>{' '}
      <span className="text-muted-foreground">{noun}</span>
    </>
  );

  if (!onClick) {
    return <span className="text-sm">{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm hover:underline underline-offset-2 decoration-muted-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
      aria-label={`${count} ${noun}`}
    >
      {content}
    </button>
  );
}

export default function ProfileMetrics({
  postCount,
  followerCount,
  followingCount,
  onOpenFollowers,
  onOpenFollowing,
  forms,
  language,
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
      <Metric
        value={followerCount}
        forms={forms.followers}
        onClick={onOpenFollowers}
        language={language}
      />
      <Metric
        value={followingCount}
        forms={forms.following}
        onClick={onOpenFollowing}
        language={language}
      />
      <Metric value={postCount} forms={forms.posts} language={language} />
    </div>
  );
}
