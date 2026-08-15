// A translatable sentence that contains styled or interpolated parts.
//
// tFallback handles a whole string. It cannot handle a sentence whose middle is
// an element:
//
//     Day <span className="font-bold tabular-nums">{state.dayOfCycle}</span>
//
// Both ways of forcing that through tFallback are wrong in a different way.
// Extracting "Day" on its own hands a translator a fragment they cannot
// reorder — and word order is exactly what changes between languages, so the
// number ends up stranded on the wrong side of it. Folding the whole thing into
// one key drops the styling that made the number readable.
//
// So the sentence stays one message and the styled part becomes a placeholder:
//
//     <TransText
//       k="cycleTracker.day"
//       en="Day {value}"
//       values={{ value: <span className="font-bold tabular-nums">{state.dayOfCycle}</span> }}
//     />
//
// The translator sees "Day {value}" and can put {value} wherever their language
// needs it. This is the same shape as react-intl's rich-text arguments and
// i18next's <Trans>; it is deliberately much smaller than either, because the
// only thing needed here is substituting a node into a translated string.
//
// The catalog holds the TEMPLATE, placeholders and all — so `en` here is the
// value that belongs in en.json, not a rendered sentence.
import { Fragment } from 'react';
import { useLanguage } from '@/lib/LanguageContext';

const TOKEN = /(\{[a-zA-Z0-9_]+\})/g;

/**
 * @param {string} k       catalog key
 * @param {string} en      English template, e.g. 'Day {value}'
 * @param {object} values  placeholder name -> React node or string
 */
export default function TransText({ k, en, values = {} }) {
  const { tFallback } = useLanguage();
  // No third argument: tFallback must NOT interpolate here, or it would stringify
  // the nodes ("[object Object]") before this function ever sees the template.
  const template = String(tFallback(k, en));

  return template.split(TOKEN).map((part, i) => {
    const m = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
    if (!m) return part ? <Fragment key={i}>{part}</Fragment> : null;
    const value = values[m[1]];
    // An unknown placeholder renders as its own token rather than disappearing.
    // A missing value is a bug in the call site, and a visible `{value}` says so
    // where a silent gap would just look like wording someone chose.
    return <Fragment key={i}>{value === undefined ? part : value}</Fragment>;
  });
}
