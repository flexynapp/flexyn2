// src/components/glance/TrendGraph.jsx
//
// The line in a trend slide: the user's own points drawn from the first one
// to today, then a dashed continuation to where the trend is heading.
//
// How it moves (a Reward-tier motion: something good just happened, it lasts
// 300 to 700ms, orange because it is progress, transform and opacity only
// where the browser lets us):
//
//   1. The solid line draws from the first point to today in 700ms on an
//      ease out, with a head dot riding its tip. Each session's dot appears
//      the moment the tip passes it, so the line visibly collects the work.
//   2. The head lands on today's point and pops once (the shared pop spring).
//   3. The dashed projection unrolls behind it in 350ms and its hollow end
//      and value fade in.
//
// It replays whenever its slide becomes the active one, because a carousel
// you swipe back to should tell the story again rather than sit finished.
// The head is moved by writing attributes from the animation's onUpdate, not
// through React state, so a frame never waits on a render.
//
// Reduced motion draws the final state at once.
//
// SVG is sized in real pixels from a ResizeObserver rather than stretched
// with preserveAspectRatio="none", which would squash the dots into ovals
// and thin the stroke on wide screens.

import React, { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT } from '@/lib/motion';

// Reward tier timing (Codex motion tiers, 300 to 700ms). Kept here until
// motion.js carries named Reward durations; move them there with it.
export const DRAW_S = 0.7;
const PROJECT_S = 0.35;
export const SETTLE_WAIT_S = 0.32;
export const DRAW_EASE = [0.33, 1, 0.68, 1];

// Slows every duration below by this factor. 1 everywhere in the app; the
// preview bench raises it so the draw can be judged frame by frame on a
// phone, which is how smoothness is judged in this repo.
export const TrendTimeScale = createContext(1);

export const HEIGHT = 104;
const PAD_TOP = 22; // room for the projected value above its point
const PAD_BOTTOM = 22; // room for the date row
const PAD_X = 8;

/**
 * @param {object} props
 * @param {Array<{ t:number, v:number }>} props.points   real points, oldest first
 * @param {{ t:number, v:number } | null} props.projection
 * @param {boolean} props.play          true while the slide is on screen
 * @param {(t:number) => string} props.formatDate
 * @param {(v:number) => string} props.formatValue
 * @param {string} props.lastLabel     under the latest point ("Today" or its date)
 * @param {string} [props.label]        accessible description of the whole chart
 */
export default function TrendGraph({ points, projection, play, formatDate, formatValue, lastLabel, label }) {
  const reduce = useReducedMotion();
  const k = useContext(TrendTimeScale);
  const DRAW = DRAW_S * k;
  const PROJECT = PROJECT_S * k;
  // The carousel mounts clones of its end slides, so the same graph can be
  // in the DOM more than once. A clip id built from the width alone would
  // collide, and url(#id) resolves to the FIRST match, which is a clone
  // nobody is animating; the dashed line then never appears.
  const clipId = `trend-proj-${useId().replace(/:/g, '')}`;
  const boxRef = useRef(null);
  const [w, setW] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const apply = () => setW(el.clientWidth);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (!w || points.length < 2) return null;
    const t0 = points[0].t;
    const t1 = projection?.t ?? points[points.length - 1].t;
    const vals = [...points.map((p) => p.v), ...(projection ? [projection.v] : [])];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) { lo -= Math.abs(lo) * 0.05 || 1; hi += Math.abs(hi) * 0.05 || 1; }
    const span = t1 - t0 || 1;
    const innerW = w - PAD_X * 2;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const x = (t) => PAD_X + ((t - t0) / span) * innerW;
    const y = (v) => PAD_TOP + (1 - (v - lo) / (hi - lo)) * innerH;
    const pts = points.map((p) => ({ x: x(p.t), y: y(p.v) }));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const proj = projection ? { x: x(projection.t), y: y(projection.v) } : null;
    return { pts, d, last, proj };
  }, [w, points, projection]);

  const pathRef = useRef(null);
  const headRef = useRef(null);
  const dotRefs = useRef([]);
  const [phase, setPhase] = useState(reduce ? 'done' : 'idle'); // idle | drawing | landed | done

  // Layout effect, so the hidden starting state is written before the first
  // paint and the full line never flashes on screen before it draws.
  useLayoutEffect(() => {
    if (!geo) return undefined;
    const path = pathRef.current;
    const len = path?.getTotalLength?.() ?? 0;
    const showDots = (upToX) => {
      geo.pts.forEach((p, i) => {
        const el = dotRefs.current[i];
        if (el) el.style.opacity = upToX + 0.5 >= p.x ? '1' : '0';
      });
    };
    if (path) path.style.strokeDasharray = `${len} ${len}`;

    if (reduce) {
      if (path) path.style.strokeDashoffset = '0';
      showDots(Infinity);
      setPhase('done');
      return undefined;
    }
    if (!play) {
      if (path) path.style.strokeDashoffset = String(len);
      showDots(-Infinity);
      setPhase('idle');
      return undefined;
    }

    if (path) path.style.strokeDashoffset = String(len);
    showDots(-Infinity);
    if (headRef.current) {
      headRef.current.setAttribute('cx', String(geo.pts[0].x));
      headRef.current.setAttribute('cy', String(geo.pts[0].y));
    }
    setPhase('drawing');
    const controls = animate(0, 1, {
      // Wait for the carousel to finish turning the page (HeroPager's settle
      // runs about 420ms) so the line draws on a page that has stopped
      // moving. Not scaled by the bench's slow motion: the pager is not.
      delay: SETTLE_WAIT_S,
      duration: DRAW,
      // Cubic ease out, not the app's EASE_OUT. EASE_OUT is built for things
      // arriving and spends its last 40% covering 3% of the distance, which
      // on a 700ms line reads (at 1/8 speed, visibly) as the line stalling
      // short of today before the pop. Cubic lands with some momentum left.
      ease: DRAW_EASE,
      onUpdate: (p) => {
        if (path) path.style.strokeDashoffset = String(len * (1 - p));
        const at = path && len ? path.getPointAtLength(len * p) : geo.last;
        if (headRef.current) {
          headRef.current.setAttribute('cx', at.x.toFixed(2));
          headRef.current.setAttribute('cy', at.y.toFixed(2));
        }
        showDots(at.x);
      },
      onComplete: () => {
        if (path) path.style.strokeDashoffset = '0';
        showDots(Infinity);
        setPhase('landed');
      },
    });
    return () => controls.stop();
  }, [geo, play, reduce, DRAW]);

  const settled = phase === 'landed' || phase === 'done';

  return (
    <div ref={boxRef} className="w-full" style={{ height: HEIGHT }} role="img" aria-label={label}>
      {geo && (
        <svg width={w} height={HEIGHT} viewBox={`0 0 ${w} ${HEIGHT}`} className="block overflow-visible" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              {/* Unrolls the dashed segment. Dashes and pathLength both use
                  stroke-dasharray, so the projection cannot draw the way the
                  solid line does; a clip that grows from today's x can. */}
              <motion.rect
                x={geo.last.x}
                y={0}
                height={HEIGHT}
                initial={false}
                animate={{ width: settled && geo.proj ? Math.max(0, geo.proj.x - geo.last.x + 8) : 0 }}
                transition={phase === 'done' ? { duration: 0 } : { duration: PROJECT, ease: EASE_OUT }}
              />
            </clipPath>
          </defs>

          {/* Hairline floor, so the chart has a ground without gridlines. */}
          <line x1={PAD_X} x2={w - PAD_X} y1={HEIGHT - PAD_BOTTOM + 4} y2={HEIGHT - PAD_BOTTOM + 4} stroke="hsl(var(--border))" strokeWidth={1} />

          {geo.proj && (
            <g clipPath={`url(#${clipId})`}>
              <line
                x1={geo.last.x} y1={geo.last.y} x2={geo.proj.x} y2={geo.proj.y}
                stroke="hsl(var(--primary) / 0.55)" strokeWidth={2} strokeDasharray="4 5" strokeLinecap="round"
              />
            </g>
          )}
          {geo.proj && (
            <motion.circle
              cx={geo.proj.x} cy={geo.proj.y} r={4}
              fill="hsl(var(--background))" stroke="hsl(var(--primary) / 0.7)" strokeWidth={2}
              initial={false}
              animate={{ opacity: settled ? 1 : 0 }}
              transition={phase === 'done' ? { duration: 0 } : { duration: PROJECT, delay: PROJECT * 0.6, ease: EASE_OUT }}
            />
          )}

          <path
            ref={pathRef}
            d={geo.d}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {geo.pts.map((p, i) => (
            <circle
              key={i}
              ref={(el) => { dotRefs.current[i] = el; }}
              cx={p.x} cy={p.y} r={2.5}
              fill="hsl(var(--primary))"
            />
          ))}

          {/* The head rides the tip while the line draws. A plain circle,
              moved by the animation's onUpdate: a motion.circle keeps its own
              copy of cx/cy and repaints it over ours. */}
          <circle
            ref={headRef}
            cx={geo.pts[0].x}
            cy={geo.pts[0].y}
            r={5}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--background))"
            strokeWidth={2}
            opacity={phase === 'drawing' ? 1 : 0}
          />
          {/* Today's point takes over from the head where it lands, with the
              Reward tier's one pop: out and back once, no wobble. */}
          <circle
            cx={geo.last.x}
            cy={geo.last.y}
            r={5}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--background))"
            strokeWidth={2}
            opacity={settled ? 1 : 0}
            // A CSS keyframe rather than framer: framer's SVG transform
            // origin is computed from its own copy of the geometry, and on a
            // measured-width chart it scaled the point about the wrong spot,
            // leaving it floating above the line (seen at 1/8 speed).
            style={{
              transformBox: 'fill-box',
              transformOrigin: 'center',
              animation: phase === 'landed' ? `trend-pop ${0.36 * k}s cubic-bezier(${EASE_OUT.join(',')})` : 'none',
            }}
          />

          {/* Date row: where it started, today, and where it is heading. */}
          <text x={PAD_X} y={HEIGHT - 4} className="fill-muted-foreground" style={{ fontSize: 11 }}>{formatDate(points[0].t)}</text>
          {geo.proj ? (
            <>
              <text x={geo.last.x} y={HEIGHT - 4} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>{lastLabel}</text>
              <motion.text
                x={w - PAD_X} y={HEIGHT - 4} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 11 }}
                initial={false} animate={{ opacity: settled ? 1 : 0 }}
                transition={phase === 'done' ? { duration: 0 } : { duration: PROJECT, delay: PROJECT * 0.6 }}
              >
                {formatDate(projection.t)}
              </motion.text>
              <motion.text
                // Above and just left of the hollow end, anchored at its right
                // edge: the dashed line arrives from the left and below
                // (rising) or above (falling) the point, and in both cases
                // passes under this box rather than through it.
                x={geo.proj.x + 4} y={geo.proj.y - 10} textAnchor="end"
                className="fill-muted-foreground font-semibold tabular-nums" style={{ fontSize: 11 }}
                initial={false} animate={{ opacity: settled ? 1 : 0 }}
                transition={phase === 'done' ? { duration: 0 } : { duration: PROJECT, delay: PROJECT * 0.6 }}
              >
                {formatValue(projection.v)}
              </motion.text>
            </>
          ) : (
            <text x={w - PAD_X} y={HEIGHT - 4} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 11 }}>{lastLabel}</text>
          )}
        </svg>
      )}
    </div>
  );
}
