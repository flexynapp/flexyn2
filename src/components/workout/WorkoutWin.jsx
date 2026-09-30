// The win screen for a saved workout. A session with a PR becomes the PR
// screen (the lift, the new best counting up, what it beat); an ordinary
// session shows the volume you moved. Either way the XP bar fills and the
// session's stats land underneath. The share card and "Save as template"
// hang off it instead of opening on their own or riding on a toast.

import React, { useEffect } from 'react';
import WinScreen from '@/components/WinScreen';
import { useButtonAnswer } from '@/components/feedback/buttonAnswer';
import { useLanguage } from '@/lib/LanguageContext';
import { fromLbs } from '@/lib/weightUnit';
import { totalVolume } from '@/lib/workoutVolume';
import { formatNumber } from '@/lib/intl';
import { TITLE_COLUMN } from '@/lib/workoutTitle';

const unitLabel = (u) => (u === 'kg' ? 'kg' : u === 'stone' ? 'st' : 'lb');

export default function WorkoutWin({
  win, weightUnit, includeBarWeight, onShareWorkout, onSharePr, onSaveTemplate, onClose,
}) {
  const { tFallback, language } = useLanguage();
  const w = win?.workout;
  const fmt = (n) => formatNumber(n, language);
  const notes = win?.notes || [];
  // "Save as template" answers on its own button: a check and "Saved", or
  // "Didn't save" with the reason under it. It used to raise a message over
  // the win screen it was pressed on.
  const templateAnswer = useButtonAnswer();
  const { reset: resetTemplateAnswer } = templateAnswer;
  // A new win starts clean, not on the last session's "Didn't save".
  useEffect(() => { resetTemplateAnswer(); }, [w, resetTemplateAnswer]);
  const saveTemplate = async () => {
    templateAnswer.reset();
    const res = await onSaveTemplate();
    if (res?.ok) templateAnswer.succeed();
    else templateAnswer.fail(res?.reason || null);
  };

  const sets = (w?.exercises || []).reduce((n, ex) => n + (ex.kind === 'cardio' ? 0 : (ex.sets || []).length), 0);
  const volLbs = w ? totalVolume(w.exercises || [], { includeBarWeight }) : 0;
  const unit = unitLabel(weightUnit);
  const stats = [
    win?.minutes > 0 && { key: 'time', value: tFallback('finish.minutes', '{n} min', { n: fmt(win.minutes) }), label: tFallback('finish.time', 'Time') },
    sets > 0 && { key: 'sets', value: fmt(sets), label: tFallback('finish.sets', 'Sets') },
  ].filter(Boolean);
  const xp = win?.xpGained > 0 ? { gained: win.xpGained, totalBefore: win.xpBefore } : null;

  const prs = win?.prs || [];
  if (win && prs.length > 0) {
    const top = [...prs].sort((a, b) => (b.delta || 0) - (a.delta || 0))[0];
    const u = win.unit || unit;
    const round = (n) => Math.round((Number(n) || 0) * 10) / 10;
    const more = prs.length - 1;
    const delta = [
      top.delta > 0 && tFallback('win.prDelta', '+{n} {unit} on your best', { n: fmt(round(top.delta)), unit: u }),
      more > 0 && (more === 1
        ? tFallback('win.onePrMore', 'And 1 more PR')
        : tFallback('win.manyPrsMore', 'And {n} more PRs', { n: fmt(more) })),
    ].filter(Boolean).join('. ');
    return (
      <WinScreen
        open
        onClose={onClose}
        size="hero"
        kicker={tFallback('win.newPr', 'New personal record')}
        subject={top.displayName || top.name}
        value={round(top.newPR)}
        decimals={Number.isInteger(round(top.newPR)) ? 0 : 1}
        unit={u}
        delta={delta || null}
        xp={xp}
        notes={notes}
        stats={volLbs > 0 ? [...stats, { key: 'vol', value: fmt(Math.round(fromLbs(volLbs, weightUnit))), label: tFallback('win.unitMoved', '{unit} moved', { unit }) }] : stats}
        primary={{ label: tFallback('win.sharePr', 'Share this PR'), onClick: () => onSharePr({ pr: top, unit: u }) }}
        secondary={{ label: tFallback('win.shareWorkout', 'Share workout'), onClick: onShareWorkout }}
      />
    );
  }

  // Headline with the biggest honest number the session has: volume, else
  // time (a cardio only session), else sets. Never a bare zero.
  let headline = { value: Math.round(fromLbs(volLbs, weightUnit)), unit, drop: null };
  if (volLbs <= 0 && win?.minutes > 0) headline = { value: win.minutes, unit: tFallback('finish.min', 'min'), drop: 'time' };
  else if (volLbs <= 0) headline = { value: sets, unit: tFallback('finish.sets', 'Sets').toLowerCase(), drop: 'sets' };

  return (
    <WinScreen
      open={!!win}
      onClose={onClose}
      kicker={tFallback('win.workoutDone', 'Workout complete')}
      subject={w?.[TITLE_COLUMN] || null}
      value={headline.value}
      unit={headline.unit}
      delta={win?.checkInBonus ? tFallback('win.checkInBonus', 'Gym check in bonus on your XP') : null}
      xp={xp}
      notes={notes}
      stats={stats.filter((c) => c.key !== headline.drop)}
      primary={{ label: tFallback('win.shareWorkout', 'Share workout'), onClick: onShareWorkout }}
      secondary={{
        label: tFallback('workout.saveTemplate', 'Save as template'),
        onClick: saveTemplate,
        answer: templateAnswer,
        doneLabel: tFallback('workout.templateSavedShort', 'Saved to regimens'),
        failedLabel: tFallback('workout.templateFailedShort', "Didn't save"),
      }}
    />
  );
}
