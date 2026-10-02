// src/components/leagues/CrestMorph.jsx
//
// A grey crest that melts from one league's shape into another's, for the
// first placement and for a demotion (geometry in src/lib/rankUpMorph.js).
// The shape changes first, in grey; the league colour arrives after it
// lands, when the sequence fades the real crest in over it.
//
// It renders once. play() then moves it by writing path attributes from
// requestAnimationFrame: SVG path data cannot be animated by the Web
// Animations API in Safari, and the tree is a dozen nodes, so a direct
// attribute write per frame is cheaper than any React render.

import { forwardRef, memo, useId, useImperativeHandle, useRef } from 'react';
import { PALETTES, chevron, STAR, Laurel, Rosette, Ribbon, FINIAL } from '@/components/leagues/LeagueTierIcon';
import { getTier } from '@/lib/leagueTiers';
import { crestShape, greyPalette, morphAt, morphEase } from '@/lib/rankUpMorph';

function Glyph({ tier, p }) {
  if (tier === 'bronze') return <path d={chevron(25)} fill={p.ink} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />;
  if (tier === 'silver') {
    return (
      <>
        <path d={chevron(19)} fill={p.ink} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
        <path d={chevron(30)} fill={p.ink} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
      </>
    );
  }
  if (tier === 'gold' || tier === 'platinum') return <path d={STAR} fill={p.ink} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />;
  // The stone's cut: the line under its crown row and the facets below it.
  const y = tier === 'legend' ? 6 : 2;
  return <path d={`M14 ${27 + y} H50 M27 ${27 + y} L32 ${54 + y} L37 ${27 + y}`} fill="none" stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" opacity="0.8" />;
}

function Back({ level, p }) {
  return (
    <>
      {level >= 4 && <Rosette p={p} />}
      {level >= 3 && <Laurel p={p} />}
    </>
  );
}

function Front({ level, p }) {
  return (
    <>
      {level >= 2 && <Ribbon p={p} pips={level} />}
      {level >= 4 && <path d={FINIAL} fill={p.light} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />}
    </>
  );
}

/**
 * @param {object} props
 * @param {{tier: string, level: number}} props.from
 * @param {{tier: string, level: number}} props.to
 * @param {number} [props.grey] how grey, matching the tint the real crest
 *   was greyed with just before (0.92 for a placement's blank shield)
 */
const CrestMorph = forwardRef(function CrestMorph({ from, to, grey = 0.92, className, style }, ref) {
  const clip = useId().replace(/:/g, '');
  const a = crestShape(from.tier);
  const b = crestShape(to.tier);
  const p = greyPalette({ ...PALETTES[from.tier], mid: getTier(from.tier).color }, grey);
  const start = morphAt(a, b, 0);
  const el = useRef({});
  const set = (k) => (node) => { el.current[k] = node; };
  const raf = useRef(0);

  useImperativeHandle(ref, () => ({
    /** Run the morph over `duration` ms. Resolves when it lands. */
    play(duration) {
      cancelAnimationFrame(raf.current);
      return new Promise((resolve) => {
        let t0 = null;
        const step = (now) => {
          if (t0 == null) t0 = now;
          const k = Math.min(1, (now - t0) / Math.max(1, duration));
          const e = morphEase(k);
          const m = morphAt(a, b, e);
          const n = el.current;
          n.wingL?.setAttribute('d', m.wing);
          n.wingR?.setAttribute('d', m.wing);
          n.covertL?.setAttribute('d', m.covert);
          n.covertR?.setAttribute('d', m.covert);
          n.wings?.setAttribute('opacity', String(m.wingOpacity));
          n.body?.setAttribute('d', m.body);
          n.bodyDark?.setAttribute('d', m.body);
          n.bodyRim?.setAttribute('d', m.body);
          n.spike?.setAttribute('opacity', String(m.spike));
          n.spike?.setAttribute('transform', `translate(32 9) scale(${Math.max(0.01, m.spike)}) translate(-32 -9)`);
          n.crown?.setAttribute('opacity', String(m.crown));
          // The glyph and the level ornaments swap while the shape is
          // mid-way, so neither is ever seen on the wrong outline.
          const g = Math.min(1, Math.max(0, (e - 0.3) / 0.4));
          n.glyphA?.setAttribute('opacity', String(1 - g));
          n.glyphB?.setAttribute('opacity', String(g));
          n.levelA?.forEach?.((x) => x?.setAttribute('opacity', String(1 - e)));
          n.levelB?.forEach?.((x) => x?.setAttribute('opacity', String(e)));
          if (k < 1) raf.current = requestAnimationFrame(step);
          else resolve();
        };
        raf.current = requestAnimationFrame(step);
      });
    },
    stop() { cancelAnimationFrame(raf.current); },
  }), [a, b]);

  const levelA = [];
  const levelB = [];
  const keepA = (node) => { if (node) levelA.push(node); el.current.levelA = levelA; };
  const keepB = (node) => { if (node) levelB.push(node); el.current.levelB = levelB; };
  const same = from.level === to.level;

  return (
    <svg viewBox="-9 -9 82 82" className={className} style={style} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${clip}r`}><rect x="32" y="-9" width="41" height="82" /></clipPath>
      </defs>
      {same ? <Back level={from.level} p={p} /> : (
        <>
          <g ref={keepA}><Back level={from.level} p={p} /></g>
          <g ref={keepB} opacity="0"><Back level={to.level} p={p} /></g>
        </>
      )}
      <g ref={set('wings')} opacity={start.wingOpacity}>
        <path ref={set('wingL')} d={start.wing} fill={p.mid} stroke={p.rim} strokeWidth="1.3" strokeLinejoin="round" />
        <path ref={set('covertL')} d={start.covert} fill={p.light} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
        <g transform="translate(64 0) scale(-1 1)">
          <path ref={set('wingR')} d={start.wing} fill={p.dark} stroke={p.rim} strokeWidth="1.3" strokeLinejoin="round" />
          <path ref={set('covertR')} d={start.covert} fill={p.mid} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
        </g>
      </g>
      <path ref={set('spike')} d="M32 0 L36 9 L32 12 L28 9 Z" fill={p.light} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round"
        opacity={start.spike} transform={`translate(32 9) scale(${Math.max(0.01, start.spike)}) translate(-32 -9)`} />
      <path ref={set('body')} d={start.body} fill={p.mid} />
      <path ref={set('bodyDark')} d={start.body} fill={p.dark} clipPath={`url(#${clip}r)`} />
      <path ref={set('bodyRim')} d={start.body} fill="none" stroke={p.rim} strokeWidth="2" strokeLinejoin="round" />
      <g ref={set('glyphA')}><Glyph tier={from.tier} p={p} /></g>
      <g ref={set('glyphB')} opacity="0"><Glyph tier={to.tier} p={p} /></g>
      <g ref={set('crown')} opacity={start.crown}>
        <path d="M19 23 L16 8 L24.5 15 L32 4 L39.5 15 L48 8 L45 23 Z" fill={p.light} stroke={p.rim} strokeWidth="1.4" strokeLinejoin="round" />
      </g>
      {same ? <Front level={from.level} p={p} /> : (
        <>
          <g ref={keepA}><Front level={from.level} p={p} /></g>
          <g ref={keepB} opacity="0"><Front level={to.level} p={p} /></g>
        </>
      )}
    </svg>
  );
});

export default memo(CrestMorph);
