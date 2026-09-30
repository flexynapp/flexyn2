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
import { useLanguage } from '@/lib/LanguageContext';

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
  onFindPeople,
  isSelf = false,
  forms,
  language,
  center = false,
}) {
  const { tFallback } = useLanguage();
  // A brand-new account rendered "0 followers · 0 following · 0 posts" —
  // three zeros in a row, which is a cold thing to show someone who just
  // finished an eleven-step signup. It also isn't information: nobody needs
  // to be told they have no followers on the day they arrive.
  //
  // Only suppressed when ALL THREE are zero. Once any one of them moves, the
  // full row returns — a real 0 next to a real 4 is a comparison, not a
  // verdict, and hiding it then would be hiding data.
  //
  // STRICT === 0, not falsy. While the counts are still loading they are
  // null/undefined, and a falsy check would show "Find people to follow" for
  // a moment on every profile — including accounts with thousands of
  // followers — before snapping to the real numbers. Requiring an explicit 0
  // means this state can only appear once we actually know the answer.
  //
  // Self only. On someone else's page it invited the VIEWER to go find people
  // from a stranger's profile, and the tap opened that stranger's empty
  // Following list. A visitor sees the real zeros instead.
  const isBrandNew = isSelf && followerCount === 0 && followingCount === 0 && postCount === 0;

  // Still loading. Hold the line's height and draw nothing, rather than
  // three zeros that snap to the real numbers a moment later.
  if (followerCount == null || followingCount == null || postCount == null) {
    return <div className="mt-3 h-5" aria-hidden="true" />;
  }

  if (isBrandNew) {
    return (
      <div className={`mt-3 ${center ? 'flex justify-center' : ''}`}>
        <button
          type="button"
          onClick={onFindPeople || onOpenFollowing}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
        >
          {tFallback("profileMetrics.findPeopleToFollow", "Find people to follow")}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 ${center ? 'justify-center' : ''}`}>
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
