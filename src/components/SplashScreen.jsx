import { useEffect, useRef } from "react";

/**
 * Flexyn opening animation — full "App Opener" design.
 *
 * Ported 1:1 from the Flexyn App Opener export (Flexyn App Opener.dc.html):
 * self-drawing flame reveal, ambient animated background (drifting warm
 * blobs, module-glyph constellation, rising embers, radial glow), specular
 * sweep + sparkles on ignite, and the "Flexyn" wordmark writing on L→R.
 *
 * Rendered full-bleed (the export's rounded phone frame is a design-tool
 * artifact) via dangerouslySetInnerHTML so the markup + CSS keyframes match
 * the source exactly rather than being re-expressed as React style objects.
 *
 * Behaviour:
 *  - Plays ONCE (flx-once), then signals onComplete. It does NOT fade itself
 *    out — LaunchSplash owns a single crossfade of the whole overlay onto the
 *    live app, so the lit mark hands straight off to the dashboard.
 *  - Respects prefers-reduced-motion (the source CSS jumps to the lit mark).
 *
 * Props:
 *  - onComplete: () => void   called once, after the animation settles.
 *  - background:  string      full-bleed backdrop colour (design default slate).
 *  - drawMs:      number      length of the draw+ignite+settle animation.
 */

// Fire palette from the export's default accent.
const C0 = "#FFD27A";
const C1 = "#FB9D38";
const C2 = "#F2700D";
const C3 = "#C2410C";

// Keyframes + classes, copied verbatim from the App Opener export.
const CSS = `
  @keyframes flx-draw{
    0%{stroke-dashoffset:1;}
    2%{stroke-dashoffset:1;animation-timing-function:cubic-bezier(.45,.05,.35,1);}
    40%{stroke-dashoffset:0;}
    100%{stroke-dashoffset:0;}
  }
  @keyframes flx-ignite{0%{opacity:0;}38%{opacity:0;animation-timing-function:cubic-bezier(.4,0,.2,1);}54%{opacity:1;}100%{opacity:1;}}
  @keyframes flx-gray{0%{opacity:1;}38%{opacity:1;animation-timing-function:cubic-bezier(.4,0,.2,1);}54%{opacity:0;}100%{opacity:0;}}
  @keyframes flx-settle{0%{transform:scale(1);}54%{transform:scale(1);animation-timing-function:cubic-bezier(.34,1.5,.5,1);}57%{transform:scale(1.035);}64%{transform:scale(1);}100%{transform:scale(1);}}
  @keyframes flx-sparkle{
    0%{opacity:0;transform:scale(.2) rotate(-18deg);animation-timing-function:cubic-bezier(.22,1,.36,1);}
    57%{opacity:0;transform:scale(.2) rotate(-18deg);animation-timing-function:cubic-bezier(.22,1,.36,1);}
    66%{opacity:1;transform:scale(1.05) rotate(0deg);animation-timing-function:cubic-bezier(.33,0,.67,1);}
    74%{opacity:1;transform:scale(1) rotate(4deg);animation-timing-function:cubic-bezier(.55,0,.9,.7);}
    86%{opacity:0;transform:scale(.55) rotate(10deg);}
    100%{opacity:0;transform:scale(.55) rotate(10deg);}
  }
  @keyframes flx-sparkle2{
    0%{opacity:0;transform:scale(.2);animation-timing-function:cubic-bezier(.22,1,.36,1);}
    61%{opacity:0;transform:scale(.2);animation-timing-function:cubic-bezier(.22,1,.36,1);}
    69%{opacity:.95;transform:scale(1.02);animation-timing-function:cubic-bezier(.55,0,.9,.7);}
    77%{opacity:.85;transform:scale(.95);animation-timing-function:cubic-bezier(.55,0,.9,.7);}
    88%{opacity:0;transform:scale(.5);}
    100%{opacity:0;transform:scale(.5);}
  }
  @keyframes flx-b1{0%{transform:translate(-12%,-10%) scale(1);}33%{transform:translate(22%,6%) scale(1.2);}66%{transform:translate(6%,20%) scale(1.08);}100%{transform:translate(-12%,-10%) scale(1);}}
  @keyframes flx-b2{0%{transform:translate(16%,14%) scale(1.12);}50%{transform:translate(-16%,-16%) scale(1);}100%{transform:translate(16%,14%) scale(1.12);}}
  @keyframes flx-b3{0%{transform:translate(-10%,16%) scale(1.05);}50%{transform:translate(18%,-14%) scale(1.28);}100%{transform:translate(-10%,16%) scale(1.05);}}
  @keyframes flx-b4{0%{transform:translate(8%,-14%) scale(1);}50%{transform:translate(-14%,14%) scale(1.18);}100%{transform:translate(8%,-14%) scale(1);}}
  @keyframes flx-glow{0%{opacity:.12;transform:translate(-50%,-52%) scale(.9);}38%{opacity:.14;transform:translate(-50%,-52%) scale(.96);}56%{opacity:.55;transform:translate(-50%,-52%) scale(1.1);}70%{opacity:.34;transform:translate(-50%,-52%) scale(1);}100%{opacity:.3;transform:translate(-50%,-52%) scale(1);}}
  @keyframes flx-float{0%{transform:translateY(0);opacity:.12;}50%{transform:translateY(-15px);opacity:.6;}100%{transform:translateY(0);opacity:.12;}}
  @keyframes flx-gdrift{0%{transform:translateY(0) rotate(-2deg);}50%{transform:translateY(-11px) rotate(2deg);}100%{transform:translateY(0) rotate(-2deg);}}
  @keyframes flx-flareA{0%{opacity:.10;transform:scale(.9);}49%{opacity:.10;transform:scale(.9);animation-timing-function:cubic-bezier(.4,0,.6,1);}57%{opacity:.44;transform:scale(1.14);animation-timing-function:cubic-bezier(.4,0,.6,1);}73%{opacity:.15;transform:scale(1);}100%{opacity:.12;transform:scale(1);}}
  @keyframes flx-flareB{0%{opacity:.09;transform:scale(.9);}49%{opacity:.09;transform:scale(.9);animation-timing-function:cubic-bezier(.4,0,.6,1);}57%{opacity:.40;transform:scale(1.13);animation-timing-function:cubic-bezier(.4,0,.6,1);}73%{opacity:.14;transform:scale(1);}100%{opacity:.11;transform:scale(1);}}
  @keyframes flx-flareC{0%{opacity:.08;transform:scale(.9);}49%{opacity:.08;transform:scale(.9);animation-timing-function:cubic-bezier(.4,0,.6,1);}57%{opacity:.36;transform:scale(1.12);animation-timing-function:cubic-bezier(.4,0,.6,1);}73%{opacity:.13;transform:scale(1);}100%{opacity:.10;transform:scale(1);}}
  @keyframes flx-ember{0%{transform:translateY(14px) scale(.5);opacity:0;}14%{opacity:.75;}70%{opacity:.5;}100%{transform:translateY(-128px) scale(1);opacity:0;}}
  @keyframes flx-sweep{0%{transform:translateX(-42px);opacity:0;}50%{transform:translateX(-42px);opacity:0;}54%{opacity:.9;}58%{transform:translateX(56px);opacity:.95;}64%{transform:translateX(104px);opacity:0;}100%{transform:translateX(104px);opacity:0;}}

  .flx-anim .flx-draw{animation:flx-draw var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-g{animation:flx-gray var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-f{animation:flx-ignite var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-lockup{animation:flx-settle var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-wordline{animation:flx-draw var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-sparkle{transform-box:fill-box;transform-origin:center;will-change:transform,opacity;animation:flx-sparkle var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-sparkle2{transform-box:fill-box;transform-origin:center;will-change:transform,opacity;animation:flx-sparkle2 var(--flx-dur,1800ms) linear infinite;}
  .flx-blob{position:absolute;border-radius:50%;filter:blur(46px);will-change:transform;}
  .flx-anim .flx-b1{animation:flx-b1 17s ease-in-out infinite;}
  .flx-anim .flx-b2{animation:flx-b2 21s ease-in-out infinite;}
  .flx-anim .flx-b3{animation:flx-b3 19s ease-in-out infinite;}
  .flx-anim .flx-b4{animation:flx-b4 23s ease-in-out infinite;}
  .flx-anim .flx-glow{animation:flx-glow var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-dot{animation:flx-float 6.5s ease-in-out infinite;}
  .flx-glyph{position:absolute;transform-origin:center;will-change:transform;}
  .flx-anim .flx-glyph{animation-name:flx-gdrift;animation-timing-function:ease-in-out;animation-iteration-count:infinite;}
  .flx-gi{display:block;transform-box:fill-box;transform-origin:center;will-change:transform,opacity;}
  .flx-anim .flx-flareA{animation:flx-flareA var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-flareB{animation:flx-flareB var(--flx-dur,1800ms) linear infinite;}
  .flx-anim .flx-flareC{animation:flx-flareC var(--flx-dur,1800ms) linear infinite;}
  .flx-ember{position:absolute;border-radius:50%;filter:blur(.3px);will-change:transform,opacity;opacity:0;}
  .flx-anim .flx-ember{animation-name:flx-ember;animation-timing-function:ease-out;animation-iteration-count:infinite;}
  .flx-sweep{transform-box:fill-box;transform-origin:center;mix-blend-mode:screen;will-change:transform,opacity;}
  .flx-anim .flx-sweep{animation:flx-sweep var(--flx-dur,1800ms) linear infinite;}

  .flx-anim.flx-noignite .flx-g{opacity:0 !important;animation:none !important;}
  .flx-anim.flx-noignite .flx-f{opacity:1 !important;animation:none !important;}
  .flx-anim.flx-nobg .flx-bg{display:none;}

  .flx-anim.flx-once .flx-draw,.flx-anim.flx-once .flx-g,.flx-anim.flx-once .flx-f,
  .flx-anim.flx-once .flx-lockup,.flx-anim.flx-once .flx-wordline,
  .flx-anim.flx-once .flx-glow,
  .flx-anim.flx-once .flx-flareA,.flx-anim.flx-once .flx-flareB,.flx-anim.flx-once .flx-flareC,
  .flx-anim.flx-once .flx-sweep,
  .flx-anim.flx-once .flx-sparkle,.flx-anim.flx-once .flx-sparkle2{animation-iteration-count:1;animation-fill-mode:both;}

  @media (prefers-reduced-motion: reduce){
    .flx-anim .flx-draw{stroke-dashoffset:0;animation:none;}
    .flx-anim .flx-f{opacity:1;animation:none;}
    .flx-anim .flx-g{opacity:0;animation:none;}
    .flx-anim .flx-lockup{transform:none;animation:none;}
    .flx-anim .flx-wordline{stroke-dashoffset:0;animation:none;}
    .flx-anim .flx-sparkle,.flx-anim .flx-sparkle2{opacity:0;animation:none;}
    .flx-anim .flx-b1,.flx-anim .flx-b2,.flx-anim .flx-b3,.flx-anim .flx-b4{animation:none;}
    .flx-anim .flx-glow{opacity:.3;animation:none;}
    .flx-anim .flx-dot{animation:none;}
    .flx-anim .flx-glyph{animation:none;}
    .flx-anim .flx-flareA,.flx-anim .flx-flareB,.flx-anim .flx-flareC{opacity:.13;animation:none;}
    .flx-anim .flx-ember{opacity:0;animation:none;}
    .flx-anim .flx-sweep{opacity:0;animation:none;}
  }
`;

const FLAME_D = "M 68.1 25.86 C 69.42 25.16 72.72 25.76 73.7 25.8 C 74.69 25.84 73.96 23.66 74.01 26.09 C 74.06 28.51 74.06 37.66 74.01 40.36 C 73.96 43.07 73.95 41.35 73.69 42.32 C 73.43 43.29 72.87 45.12 72.45 46.16 C 72.04 47.2 71.9 47.49 71.2 48.55 C 70.5 49.61 69.45 51.29 68.24 52.54 C 67.03 53.79 65.5 55.06 63.95 56.05 C 62.39 57.03 60.52 57.9 58.92 58.45 C 57.32 59 56.59 59.19 54.34 59.35 C 52.1 59.51 47.23 59.36 45.43 59.42 C 43.62 59.48 44.41 59.45 43.52 59.69 C 42.63 59.93 41.18 60.33 40.09 60.87 C 39 61.4 37.95 62.02 36.97 62.9 C 35.98 63.78 34.92 65 34.19 66.16 C 33.46 67.32 32.91 68.68 32.57 69.86 C 32.22 71.03 33.27 72.64 32.13 73.2 C 30.99 73.76 26.75 73.86 25.72 73.2 C 24.69 72.53 25.8 70.27 25.94 69.2 C 26.08 68.14 26.19 67.75 26.56 66.81 C 26.92 65.87 27.36 64.73 28.13 63.55 C 28.89 62.37 30.03 60.9 31.17 59.71 C 32.32 58.52 33.97 57.17 34.98 56.41 C 36 55.65 36.2 55.61 37.27 55.14 C 38.34 54.68 40.05 53.98 41.39 53.63 C 42.72 53.28 43.19 53.15 45.27 53.04 C 47.36 52.93 51.51 53.27 53.89 52.97 C 56.26 52.67 58.21 51.78 59.53 51.23 C 60.85 50.69 60.98 50.45 61.81 49.71 C 62.65 48.97 63.75 47.85 64.51 46.81 C 65.28 45.77 65.95 44.58 66.42 43.48 C 66.89 42.38 67.2 41.46 67.32 40.22 C 67.44 38.98 68.01 36.15 67.14 36.04 C 66.27 35.92 63.65 38.68 62.12 39.52 C 60.58 40.36 59.17 40.72 57.93 41.08 C 56.68 41.43 56.62 41.57 54.65 41.67 C 52.68 41.77 48.29 41.51 46.11 41.67 C 43.94 41.82 43.01 42.08 41.62 42.61 C 40.22 43.13 38.74 44.1 37.73 44.81 C 36.72 45.53 36.25 46.02 35.55 46.88 C 34.85 47.75 34.02 48.98 33.54 50 C 33.06 51.02 33.39 52.17 32.68 53.03 C 31.97 53.89 30.43 54.33 29.27 55.17 C 28.11 56 26.33 58.26 25.72 58.06 C 25.11 57.87 25.52 55.23 25.61 53.99 C 25.7 52.74 25.83 51.88 26.25 50.58 C 26.67 49.28 27.39 47.49 28.13 46.16 C 28.86 44.83 29.4 43.91 30.66 42.61 C 31.92 41.31 34.48 39.28 35.67 38.37 C 36.86 37.47 36.86 37.59 37.8 37.19 C 38.74 36.79 40.22 36.28 41.31 35.97 C 42.4 35.67 42.02 35.51 44.36 35.36 C 46.7 35.21 52.6 35.38 55.34 35.07 C 58.07 34.77 59.45 34.01 60.75 33.54 C 62.04 33.07 62.27 32.83 63.11 32.24 C 63.95 31.65 64.95 31.06 65.78 30 C 66.61 28.94 66.78 26.56 68.1 25.86 Z";
const MASK_D = "M 22.4 53.6 C 24.0 54.3 25.6 55.1 26.63 55.73 C 26.74 55.55 27.05 55.00 27.26 54.63 C 27.47 54.27 27.59 54.09 27.89 53.52 C 28.20 52.96 28.67 52.00 29.10 51.25 C 29.53 50.50 29.98 49.75 30.46 49.02 C 30.94 48.29 31.45 47.56 31.98 46.86 C 32.52 46.16 33.07 45.46 33.67 44.80 C 34.28 44.15 34.91 43.52 35.60 42.95 C 36.28 42.38 37.01 41.84 37.78 41.38 C 38.54 40.93 39.35 40.53 40.18 40.20 C 41.01 39.86 41.87 39.60 42.74 39.37 C 43.61 39.14 44.51 38.97 45.42 38.83 C 46.32 38.69 47.25 38.61 48.18 38.54 C 49.11 38.46 50.06 38.44 50.99 38.36 C 51.92 38.28 52.85 38.20 53.76 38.07 C 54.66 37.94 55.57 37.79 56.45 37.59 C 57.32 37.39 58.20 37.16 59.02 36.84 C 59.85 36.53 60.63 36.13 61.40 35.73 C 62.17 35.32 62.90 34.82 63.64 34.41 C 64.39 33.99 65.18 33.49 65.85 33.21 C 66.52 32.93 67.14 32.75 67.66 32.73 C 68.18 32.71 68.62 32.82 68.98 33.10 C 69.35 33.38 69.65 33.83 69.85 34.39 C 70.06 34.95 70.19 35.69 70.20 36.47 C 70.21 37.26 70.06 38.23 69.90 39.11 C 69.75 39.98 69.52 40.88 69.27 41.73 C 69.01 42.58 68.72 43.41 68.37 44.20 C 68.02 45.00 67.64 45.77 67.19 46.50 C 66.75 47.23 66.25 47.92 65.70 48.58 C 65.16 49.23 64.56 49.85 63.93 50.41 C 63.29 50.97 62.61 51.49 61.89 51.96 C 61.18 52.44 60.42 52.86 59.63 53.24 C 58.85 53.62 58.03 53.95 57.20 54.25 C 56.36 54.55 55.50 54.80 54.63 55.04 C 53.77 55.27 52.88 55.46 51.98 55.64 C 51.09 55.82 50.19 55.97 49.29 56.13 C 48.38 56.29 47.47 56.42 46.57 56.58 C 45.67 56.74 44.77 56.90 43.89 57.10 C 43.01 57.31 42.13 57.52 41.27 57.80 C 40.42 58.07 39.58 58.38 38.77 58.75 C 37.97 59.13 37.19 59.56 36.45 60.05 C 35.71 60.54 35.00 61.09 34.35 61.69 C 33.70 62.28 33.09 62.94 32.56 63.64 C 32.03 64.34 31.61 65.15 31.15 65.87 C 30.69 66.60 30.25 67.31 29.81 67.99 C 29.36 68.67 28.80 69.44 28.49 69.94 C 28.18 70.45 28.13 70.68 27.95 71.02 C 27.76 71.36 27.47 71.82 27.38 71.98";

function buildMarkup(bg, dur) {
  return `<div class="flx-anim flx-once flx-noignite" style="--flx-bg:${bg};--flx-dur:${dur};position:absolute;inset:0;background:var(--flx-bg,#3F4D5A);overflow:hidden;">
    <div class="flx-bg" style="position:absolute;inset:0;z-index:0;">
      <div class="flx-blob flx-b1" style="width:340px;height:340px;top:-50px;left:-40px;background:radial-gradient(circle,rgba(251,157,56,.6) 0%,rgba(251,157,56,0) 68%);"></div>
      <div class="flx-blob flx-b2" style="width:380px;height:380px;bottom:-70px;right:-50px;background:radial-gradient(circle,rgba(194,65,12,.6) 0%,rgba(194,65,12,0) 68%);"></div>
      <div class="flx-blob flx-b3" style="width:320px;height:320px;top:200px;left:20px;background:radial-gradient(circle,rgba(242,112,13,.58) 0%,rgba(242,112,13,0) 68%);"></div>
      <div class="flx-blob flx-b4" style="width:300px;height:300px;top:70px;right:-30px;background:radial-gradient(circle,rgba(255,210,122,.5) 0%,rgba(255,210,122,0) 68%);"></div>
      <div class="flx-glow" style="position:absolute;top:48%;left:50%;width:430px;height:430px;transform:translate(-50%,-52%);background:radial-gradient(circle,rgba(249,150,54,.5) 0%,rgba(249,120,30,0) 62%);filter:blur(6px);pointer-events:none;will-change:opacity,transform;"></div>
      <div style="position:absolute;inset:0;background:radial-gradient(120% 92% at 50% 42%,rgba(0,0,0,0) 46%,rgba(0,0,0,.36) 100%);pointer-events:none;"></div>
      <div style="position:absolute;inset:0;background-image:url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22140%22%20height=%22140%22%3E%3Cfilter%20id=%22n%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%220.85%22%20numOctaves=%222%22%20stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect%20width=%22100%25%22%20height=%22100%25%22%20filter=%22url(%23n)%22/%3E%3C/svg%3E');opacity:.05;mix-blend-mode:overlay;pointer-events:none;"></div>
      <div style="position:absolute;inset:0;pointer-events:none;">
        <div class="flx-glyph" style="left:13%;top:14%;animation-duration:7.6s;animation-delay:0s;"><svg class="flx-gi flx-flareA" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#F9B04A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg></div>
        <div class="flx-glyph" style="right:12%;top:11%;animation-duration:8.8s;animation-delay:1.1s;"><svg class="flx-gi flx-flareA" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FB9D38" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.4 14.4 9.6 9.6"></path><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"></path><path d="m21.5 21.5-1.4-1.4"></path><path d="M3.9 3.9 2.5 2.5"></path><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"></path></svg></div>
        <div class="flx-glyph" style="left:48%;top:7%;animation-duration:9.2s;animation-delay:2.3s;"><svg class="flx-gi flx-flareA" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFB866" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"></path></svg></div>
        <div class="flx-glyph" style="left:9%;top:39%;animation-duration:8.1s;animation-delay:1.7s;"><svg class="flx-gi flx-flareB" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#F2700D" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg></div>
        <div class="flx-glyph" style="right:9%;top:37%;animation-duration:7.3s;animation-delay:.5s;"><svg class="flx-gi flx-flareB" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F9B04A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path></svg></div>
        <div class="flx-glyph" style="right:24%;top:23%;animation-duration:8.5s;animation-delay:3.1s;"><svg class="flx-gi flx-flareB" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFB866" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"></path><circle cx="12" cy="8" r="6"></circle></svg></div>
        <div class="flx-glyph" style="left:16%;top:67%;animation-duration:7.9s;animation-delay:.9s;"><svg class="flx-gi flx-flareC" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FB9D38" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg></div>
        <div class="flx-glyph" style="right:16%;top:65%;animation-duration:8.7s;animation-delay:2.6s;"><svg class="flx-gi flx-flareC" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#F2700D" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg></div>
        <div class="flx-glyph" style="left:23%;top:86%;animation-duration:7.4s;animation-delay:1.9s;"><svg class="flx-gi flx-flareC" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#F9B04A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"></path><path d="M7 2v20"></path><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"></path></svg></div>
        <div class="flx-glyph" style="right:22%;top:85%;animation-duration:9s;animation-delay:.3s;"><svg class="flx-gi flx-flareC" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#FB9D38" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"></polyline><line x1="13" x2="19" y1="19" y2="13"></line><line x1="16" x2="20" y1="16" y2="20"></line><line x1="19" x2="21" y1="21" y2="19"></line><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"></polyline><line x1="5" x2="9" y1="14" y2="18"></line><line x1="7" x2="4" y1="17" y2="20"></line><line x1="3" x2="5" y1="19" y2="21"></line></svg></div>
      </div>
      <div style="position:absolute;inset:0;pointer-events:none;">
        <div class="flx-ember" style="left:12%;bottom:6%;width:3px;height:3px;background:#FFD27A;animation-duration:6.5s;animation-delay:0s;"></div>
        <div class="flx-ember" style="left:18%;bottom:11%;width:2px;height:2px;background:#FB9D38;animation-duration:7.8s;animation-delay:1.2s;"></div>
        <div class="flx-ember" style="left:27%;bottom:4%;width:4px;height:4px;background:#FFF6DE;animation-duration:5.9s;animation-delay:2.4s;"></div>
        <div class="flx-ember" style="left:35%;bottom:14%;width:3px;height:3px;background:#F2700D;animation-duration:8.4s;animation-delay:.6s;"></div>
        <div class="flx-ember" style="left:44%;bottom:8%;width:2px;height:2px;background:#FFD27A;animation-duration:6.1s;animation-delay:3.1s;"></div>
        <div class="flx-ember" style="left:52%;bottom:3%;width:3px;height:3px;background:#FB9D38;animation-duration:7.2s;animation-delay:1.8s;"></div>
        <div class="flx-ember" style="left:61%;bottom:12%;width:4px;height:4px;background:#FFF6DE;animation-duration:9s;animation-delay:4s;"></div>
        <div class="flx-ember" style="left:70%;bottom:6%;width:2px;height:2px;background:#F2700D;animation-duration:6.7s;animation-delay:2.2s;"></div>
        <div class="flx-ember" style="left:78%;bottom:15%;width:3px;height:3px;background:#FFD27A;animation-duration:7.5s;animation-delay:.9s;"></div>
        <div class="flx-ember" style="left:86%;bottom:5%;width:3px;height:3px;background:#FB9D38;animation-duration:8s;animation-delay:3.6s;"></div>
        <div class="flx-ember" style="left:15%;bottom:22%;width:2px;height:2px;background:#FFF6DE;animation-duration:6.3s;animation-delay:2.8s;"></div>
        <div class="flx-ember" style="left:40%;bottom:26%;width:4px;height:4px;background:#FFD27A;animation-duration:7s;animation-delay:1.4s;"></div>
        <div class="flx-ember" style="left:66%;bottom:20%;width:2px;height:2px;background:#FB9D38;animation-duration:8.6s;animation-delay:4.4s;"></div>
        <div class="flx-ember" style="left:90%;bottom:10%;width:3px;height:3px;background:#F2700D;animation-duration:6.8s;animation-delay:3.3s;"></div>
      </div>
    </div>

    <div style="position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;">
      <div class="flx-lockup" style="transform-origin:center;will-change:transform;">
        <svg class="flx-mark" width="150" height="190.4" viewBox="24 10 52 66" style="display:block;overflow:visible;margin-top:-40px;">
          <defs>
            <linearGradient id="flxFire" x1="0" y1="26" x2="0" y2="73" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="${C0}"></stop>
              <stop offset="30%" stop-color="${C1}"></stop>
              <stop offset="62%" stop-color="${C2}"></stop>
              <stop offset="100%" stop-color="${C3}"></stop>
            </linearGradient>
            <linearGradient id="flxGray" x1="0" y1="26" x2="0" y2="73" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#949AA3"></stop>
              <stop offset="100%" stop-color="#565D67"></stop>
            </linearGradient>
            <mask id="flxReveal" maskContentUnits="userSpaceOnUse">
              <path class="flx-draw" d="${MASK_D}" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1"></path>
            </mask>
            <clipPath id="flxSil" clipPathUnits="userSpaceOnUse"><use href="#flxFirePath"></use></clipPath>
            <linearGradient id="flxShine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"></stop><stop offset=".5" stop-color="#fff" stop-opacity=".9"></stop><stop offset="1" stop-color="#fff" stop-opacity="0"></stop></linearGradient>
          </defs>
          <path class="flx-g" d="${FLAME_D}" fill="url(#flxGray)" mask="url(#flxReveal)"></path>
          <path id="flxFirePath" class="flx-f" d="${FLAME_D}" fill="url(#flxFire)" mask="url(#flxReveal)"></path>
          <g clip-path="url(#flxSil)"><rect class="flx-sweep" x="20" y="6" width="13" height="78" fill="url(#flxShine)" transform="skewX(-16)"></rect></g>
          <path class="flx-sparkle" d="M 67 15 C 67.42 18 67.7 18.3 71 19 C 67.7 19.7 67.42 20 67 23 C 66.58 20 66.3 19.7 63 19 C 66.3 18.3 66.58 18 67 15 Z" fill="#FFF1CC"></path>
          <path class="flx-sparkle2" d="M 61.5 21.4 C 61.66 22.9 61.9 23.1 63.7 23.5 C 61.9 23.9 61.66 24.1 61.5 25.6 C 61.34 24.1 61.1 23.9 59.3 23.5 C 61.1 23.1 61.34 22.9 61.5 21.4 Z" fill="#FFF6DE"></path>
        </svg>
      </div>

      <svg class="flx-word" width="196" height="80" viewBox="0 0 320 130" style="display:block;overflow:visible;">
        <defs>
          <mask id="flxWordReveal" maskContentUnits="userSpaceOnUse">
            <path class="flx-wordline" d="M -12 66 L 332 66" fill="none" stroke="#fff" stroke-width="140" stroke-linecap="butt" pathLength="1" stroke-dasharray="1 1"></path>
          </mask>
        </defs>
        <text x="160" y="90" text-anchor="middle" font-family="'Leckerli One', cursive" font-size="86" fill="#FFFFFF" mask="url(#flxWordReveal)">Flexyn</text>
      </svg>
    </div>
  </div>`;
}

export default function SplashScreen({
  onComplete,
  background = "#3F4D5A",
  drawMs = 1600,
}) {
  const doneRef = useRef(false);

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Signal completion once the play-once animation has settled (plus a
  // short hold on the lit mark). We do NOT fade ourselves out here —
  // LaunchSplash crossfades the whole overlay onto the live app.
  useEffect(() => {
    const holdAfterAnim = 200;
    const activeMs = prefersReduced ? 400 : drawMs + holdAfterAnim;
    const t = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onComplete && onComplete();
    }, activeMs);
    return () => clearTimeout(t);
  }, [drawMs, prefersReduced, onComplete]);

  return (
    <div
      role="img"
      aria-label="Flexyn"
      style={{ position: "fixed", inset: 0, zIndex: 9999, background, overflow: "hidden" }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div
        style={{ position: "absolute", inset: 0 }}
        dangerouslySetInnerHTML={{ __html: buildMarkup(background, `${drawMs}ms`) }}
      />
    </div>
  );
}
