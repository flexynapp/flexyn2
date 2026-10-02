// src/components/hub/CapsuleOpener.jsx
//
// The capsule open: a full-screen stage where the user cracks the canister
// open a strike at a time (CrackStage), over a field of moving colour, and
// the reveal lays the item on a plate with where it sits in the set.
//
// Presentation only. Every capsule is spent and its item granted by
// open_capsule_atomic (migration 255) before the first strike; the climb
// is theatre over a decision the server already made. On a pre-255 database
// the legacy claim_capsule_loot roll is used and useBagFlow finalizes it on
// Collect. Nothing in this file writes a capsule row.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { getItemsByRarity, VARIANTS, lootDescription } from '@/lib/lootCatalog';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { pickItemForRoll, buildCandidateMenu, hydrateItemById } from '@/lib/lootRoll';
import { buildLabel, copyDiagnostics } from '@/lib/buildInfo';
import { supabase } from '@/api/supabaseClient';
import { triggerHaptic } from '@/lib/haptic';
import { useAuth } from '@/lib/AuthContext';
import * as inventory from '@/lib/data/inventory';
import { buildCollection, ownershipFrom } from '@/lib/collection';
import { setNumber, formatSetNo, setFan } from '@/lib/capsuleShelf';
import { sellPriceFor } from '@/lib/sellPrice';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import Sticker from '@/components/capsules/Sticker';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import PityMeter from '@/components/capsules/PityMeter';
import { NotchedCorner } from '@/components/capsules/parts';
import SetFan from '@/components/capsules/SetFan';
import { tierName, rarityName } from '@/components/capsules/words';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { OpenerStage, useOpenerFx, dramaFor } from '@/components/capsules/openFx';
import CrackStage from '@/components/capsules/CrackStage';

// ─── Rarity ladder ────────────────────────────────────────────────────────────
const RARITY_LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];
function rarityRank(r) {
  const i = RARITY_LADDER.indexOf(r);
  return i < 0 ? 0 : i;
}

// ─── Rarity ranking + a single server-authoritative roll ──────────────────────
// Pulled out of handleOpen so one capsule and ten capsules share exactly
// one roll path. Every roll is its own claim_capsule_loot call (migration
// 028), which locks that capsule row and rolls server-side — batching is
// purely a UI affordance, it does not touch how loot is decided.
// Codes that mean "this function isn't deployed here".
// PGRST202 comes from PostgREST's schema cache before the request ever
// reaches Postgres; 42883/42P01 come from Postgres itself.
const MISSING_FN_CODES = new Set(['PGRST202', '42883', '42P01']);

async function rollOneCapsule(capsuleId) {
  // ── Atomic path (migration 255) ──────────────────────────────────────
  // One call spends the capsule AND grants the item. Nothing is owed
  // afterwards, so an interrupted reveal can no longer destroy loot.
  const { data, error } = await supabase.rpc('open_capsule_atomic', {
    p_capsule_id: capsuleId,
    p_candidates: buildCandidateMenu(),
  });

  if (!error) {
    if (!data) return null;
    const variant = (data.variant && VARIANTS && VARIANTS[data.variant]) ? data.variant : null;
    // Rehydrate the full catalog entry (description, theme preview, frame
    // css) from the id the server granted, then fall back to the server's own
    // fields if this bundle's catalog doesn't know the id.
    //
    // This used to call pickItemForRoll(category, rarity) — i.e. re-roll an
    // item of the same tier locally — and only accept it if it happened to
    // match data.item_id. Since migration 267 the server picks from
    // loot_catalog, so a local re-roll almost never matches, and every theme
    // and frame drop would have fallen through to the bare server fields and
    // lost its preview colours and CSS. Look up by id instead.
    const catalogItem = hydrateItemById(data.item_id, data.category);
    const base = catalogItem
      ? catalogItem
      : { id: data.item_id, name: data.item_name, emoji: data.item_emoji,
          rarity: data.rarity, type: data.item_type };
    const item = { ...base, rarity: data.rarity };
    return { item: variant ? { ...item, variant } : item, granted: true };
  }

  // ── Legacy two-step fallback ─────────────────────────────────────────
  // The frontend auto-deploys from main while the SQL is pasted by hand,
  // so a new client WILL meet a pre-255 database. Only "the function does
  // not exist" falls through; anything else is a real error.
  //
  // PGRST202 is the important one and it is easy to miss: a missing RPC
  // never reaches Postgres, so PostgREST answers from its schema cache
  // with PGRST202 rather than Postgres's 42883. Probing the undeployed
  // function returned exactly that, so a 42883-only check would have
  // thrown instead of falling back — breaking capsule opening for every
  // user in the window between the deploy and the SQL being run.
  if (!MISSING_FN_CODES.has(error.code)) {
    const e = new Error(error.message || 'open_capsule_atomic failed');
    e.missingRpc = false;
    throw e;
  }

  const legacy = await supabase.rpc('claim_capsule_loot', { p_capsule_id: capsuleId });
  if (legacy.error) {
    const e = new Error(legacy.error.message || 'claim_capsule_loot failed');
    // Pre-028 hosts fail closed. The removed alternative was a client-side
    // Math.random() roll, i.e. "open DevTools and force legendary".
    e.missingRpc = MISSING_FN_CODES.has(legacy.error.code);
    throw e;
  }
  const d = legacy.data;
  if (!d) return null;

  const variant = (d.variant && VARIANTS && VARIANTS[d.variant]) ? d.variant : null;
  let item = pickItemForRoll(d.category, d.rarity);
  if (!item) {
    const fallback = getItemsByRarity(d.rarity);
    item = fallback.length ? fallback[0] : null;
  }
  if (!item) return null;
  // granted:false — the caller must still finalize this one on Claim.
  return { item: variant ? { ...item, variant } : item, granted: false };
}


// Ten capsules is the most one open runs; the bag and the Capsules page
// both cap at this.
const MAX_BATCH = 10;

// One more thing a single reveal says: where this item sits in the set and
// how many the user now holds. Derived from the inventory read AFTER the
// roll, so it describes what the server granted.
function describeResult(item, results, inv) {
  // A legacy roll is not in inventory until Collect finalizes it; count it
  // as held so the reveal does not say "0 copies".
  const pendingSame = results.filter(r => !r.granted && r.item.id === item.id).length;
  const pendingAll = results.filter(r => !r.granted).map(r => ({ item_id: r.item.id }));
  const copies = (inv ?? []).filter(r => r?.item_id === item.id).length + pendingSame;
  const inThisOpen = results.filter(r => r.item.id === item.id).length;
  const isNew = copies - inThisOpen <= 0;
  const set = setNumber(item.id);
  const ownership = inv ? ownershipFrom([...inv, ...pendingAll]) : null;
  const stickers = ownership ? buildCollection('stickers', ownership) : null;
  return {
    copies: Math.max(copies, 1), isNew, set,
    owned: stickers?.owned ?? null, total: stickers?.total ?? null,
    // The fan only counts a sticker that is in the set; others get no lead.
    fan: inv ? setFan([...pendingAll, ...inv], { teasers: 0, lead: set ? item.id : null }) : [],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
// Phases: 'idle' → 'rolling' → 'opening' → 'revealing'
//
// 'rolling' is the roll in flight: the canister waits on the stage and a tap
// does nothing yet. 'opening' runs CrackStage once per capsule, in shelf
// order ("Capsule 2 of 3"): the user cracks it open a strike at a time.
//
// The page starts rolling the moment it mounts: the tap that opened it (Open
// on the Capsules page, a capsule in the bag) was the decision. 'idle' is
// only ever on screen after the roll failed, or without autoStart.
const STOW_MS = 900;

/**
 * @param {Function} [rollCapsule]   stands in for the server roll, for the
 *   preview bench only. Production never passes it.
 * @param {Function} [loadInventory] same, for the inventory read.
 */
export default function CapsuleOpener({
  rows, next, onClaim, onClaimAndOpenNext, onClose, autoStart = true,
  rollCapsule = rollOneCapsule, loadInventory = inventory.listItems,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fx = useOpenerFx();
  const targets = useMemo(
    () => (Array.isArray(rows) ? rows : []).filter(Boolean).slice(0, MAX_BATCH),
    [rows],
  );
  const isBatch = targets.length > 1;
  const tier = ['standard', 'premium', 'elite'].includes(targets[0]?.capsule_type)
    ? targets[0].capsule_type : 'standard';

  const [phase, setPhase] = useState(autoStart ? 'rolling' : 'idle');
  const [failed, setFailed] = useState(false);
  // [{ capsuleId, item, granted }] — every successful roll from this open,
  // in shelf order, which is the order they are cracked in.
  const [results, setResults] = useState([]);
  const [current, setCurrent] = useState(0);
  // Which result the reveal plate shows. The best pull first.
  const [pick, setPick] = useState(0);
  // The inventory as the server holds it after the roll.
  const [inv, setInv] = useState(null);
  const [collecting, setCollecting] = useState(false);
  const [stowing, setStowing] = useState(false);

  // The pity reading from BEFORE the roll. A fresh read during the open
  // could show the counter reset to zero, which spoils an epic before the
  // climb reaches it.
  const [pitySnapshot] = useState(() => queryClient.getQueryData(['capsulePity', user?.email]) ?? null);

  // Synchronous guard against a double open (StrictMode, a fast re-tap).
  const openGuardRef = useRef(false);

  const handleOpen = useCallback(async () => {
    if (openGuardRef.current) return;
    openGuardRef.current = true;
    setFailed(false);
    setPhase('rolling');

    const fail = () => {
      openGuardRef.current = false;
      setFailed(true);
      setPhase('idle');
    };

    if (targets.length === 0 || targets.some(c => !c?.id)) {
      toast.error(tFallback('capsuleOpener.missing', 'Capsule missing. Refresh and try again.'));
      fail();
      return;
    }

    let rolled;
    try {
      // Each capsule is its own server roll; parallel is safe because the
      // RPC locks one row and no two targets share a row.
      rolled = await Promise.all(targets.map(async (c) => {
        const res = await rollCapsule(c.id);
        return { capsuleId: c.id, item: res?.item ?? null, granted: !!res?.granted };
      }));
    } catch (err) {
      if (err?.missingRpc) {
        toast.error(tFallback('capsuleOpener.updatePending', 'Capsule system update pending. Try again later.'));
      } else {
        console.error('[CapsuleOpener] roll failed:', err);
        toast.error(tFallback('capsuleOpener.openFailed', 'Could not open capsule. Try again.'));
      }
      fail();
      return;
    }

    const ok = rolled.filter(r => r.item);
    if (ok.length === 0) {
      toast.error(targets.length > 1
        ? tFallback('capsuleOpener.alreadyOpenedMany', 'Those capsules were already opened.')
        : tFallback('capsuleOpener.alreadyOpened', 'Capsule already opened.'));
      fail();
      return;
    }
    if (ok.length < targets.length) {
      toast.info(tFallback('capsuleOpener.someOpenedElsewhere', '{n} were already opened on another device.', { n: targets.length - ok.length }));
    }

    // Best pull first on the reveal plate; the cracks still run in shelf order.
    const best = ok.reduce((a, b) => (rarityRank(b.item.rarity) > rarityRank(a.item.rarity) ? b : a));
    setResults(ok);
    setPick(ok.indexOf(best));
    setCurrent(0);
    setPhase('opening');

    // What the set looks like now. A failed read hides the set lines on the
    // reveal rather than printing numbers from before the open.
    if (user?.email) {
      Promise.resolve(loadInventory(user.email)).then(setInv).catch(() => setInv(null));
    }
  }, [targets, tFallback, user?.email, rollCapsule, loadInventory]);

  useEffect(() => {
    if (autoStart) handleOpen();
    // Once, on mount. A remount (the next open) is a new component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opening = results[current];

  // A capsule is open: the next one, or the reveal.
  const handleStageDone = useCallback(() => {
    if (current + 1 < results.length) setCurrent(i => i + 1);
    else setPhase('revealing');
  }, [current, results.length]);

  const skip = useCallback(() => setPhase('revealing'), []);

  const shown = results[pick]?.item ?? null;

  const collect = useCallback(async (andNext) => {
    if (collecting) return;
    setCollecting(true);
    if (andNext && next) {
      await onClaimAndOpenNext?.(results);
      return;
    }
    // Collect is shown, not announced: the plate drops toward the bag and
    // the line under it says where it went, then the stage closes. This
    // replaced a toast that landed over the page title behind the opener.
    setStowing(true);
    fx.paint({ mood: 'enter' });
    await new Promise(r => setTimeout(r, fx.reduced ? 500 : STOW_MS));
    await onClaim?.(results);
  }, [collecting, next, onClaim, onClaimAndOpenNext, results, fx]);

  const handleCopyBuild = useCallback(async () => {
    const result = await copyDiagnostics();
    if (result === 'ok') toast.success(tFallback('capsuleOpener.buildCopied', 'Copied build info to clipboard.'));
    else if (result === 'unavailable') toast.error(tFallback('capsuleOpener.clipboardUnavailable', 'Clipboard unavailable. The build is shown on the button.'));
    else toast.error(tFallback('capsuleOpener.copyBlocked', 'Could not copy. Your browser blocked clipboard access.'));
  }, [tFallback]);

  // Scroll lock for the opener's whole lifetime (reference-counted).
  useBodyScrollLock();

  // Escape closes only while nothing is rolling: the capsule is spent the
  // moment the roll returns, so leaving mid-open would hide a granted item
  // behind a closed screen until the bag is reopened.
  const canClose = phase === 'idle' && (failed || !autoStart);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && canClose) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canClose, onClose]);

  const titleText = phase === 'revealing'
    ? (isBatch
      ? tFallback('capsuleOpener.openedMany', '{n} opened', { n: results.length })
      : tFallback('capsuleOpener.opened', 'Opened'))
    : tFallback('capsuleOpener.opening', 'Opening');
  const subtitle = isBatch
    ? tFallback('capsuleOpener.tierCapsules', '{tier} capsules', { tier: tierName(tFallback, tier) })
    : tFallback('capsuleOpener.tierCapsule', '{tier} capsule', { tier: tierName(tFallback, tier) });

  const onStage = phase === 'rolling' || (phase === 'opening' && opening);

  return (
    <div
      // `dark` pins the app's own dark tokens for this subtree: the opener
      // is a stage in either theme, and the canister and stickers are drawn
      // against a dark ground.
      className="dark fixed inset-0 z-50 flex flex-col bg-background text-foreground overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="capsule-opener-title"
    >
      <OpenerStage fx={fx} />
      <div ref={fx.shakeRef} className="relative mx-auto w-full max-w-lg flex-1 flex flex-col min-h-0">
        <header className="h-[60px] shrink-0 px-5 pt-2 flex items-center justify-between gap-2">
          <h2 id="capsule-opener-title" className="font-display text-title">{titleText}</h2>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-label text-muted-foreground truncate">{subtitle}</span>
            {canClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={tFallback('capsuleOpener.closeCapsuleDialog', 'Close capsule dialog')}
                className="-me-2 w-11 h-11 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        {/* ── IDLE: the roll failed, or waiting for a tap ───────────────── */}
        {phase === 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5 pb-6">
            <CapsuleCanister tier={tier} height="clamp(150px, 28vh, 240px)" />
            {failed ? (
              <div className="flex flex-col items-center gap-2 w-full max-w-xs">
                <button
                  type="button"
                  onClick={handleOpen}
                  className="w-full h-14 rounded-full bg-primary text-primary-foreground font-display text-title"
                >
                  {tFallback('capsuleOpener.tryAgain', 'Try again')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full h-11 text-label font-semibold text-foreground"
                >
                  {tFallback('common.close', 'Close')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleOpen}
                className="w-full max-w-xs h-14 rounded-full bg-primary text-primary-foreground font-display text-title"
              >
                {tFallback('capsuleOpener.openCapsule', 'Open Capsule')}
              </button>
            )}
          </div>
        )}

        {/* ── ROLLING + OPENING: crack it ───────────────────────────────── */}
        {onStage && (
          <div className="flex-1 flex flex-col">
            <CrackStage
              key={phase === 'opening' ? opening.capsuleId : 'waiting'}
              fx={fx}
              tier={tier}
              rarity={phase === 'opening' ? opening.item.rarity : null}
              batch={isBatch}
              onDone={handleStageDone}
            />
            <div className="px-5 flex flex-col items-center gap-2">
              {isBatch && phase === 'opening' && (
                <>
                  <span className="stamp">
                    {tFallback('capsuleOpener.capsuleOf', 'Capsule {i} of {n}', { i: current + 1, n: results.length })}
                  </span>
                  <button type="button" onClick={skip} className="h-11 px-4 text-label font-semibold text-foreground">
                    {tFallback('capsuleOpener.skip', 'Skip to results')}
                  </button>
                </>
              )}
            </div>
            <div className="px-5 pt-4 pb-6 mt-auto">
              <PityMeter bar snapshot={pitySnapshot} />
            </div>
          </div>
        )}

        {/* ── REVEAL ─────────────────────────────────────────────────────── */}
        {phase === 'revealing' && shown && (
          <Reveal
            fx={fx}
            results={results}
            pick={pick}
            setPick={setPick}
            inv={inv}
            fmt={fmt}
            tier={tier}
            next={next}
            collecting={collecting}
            stowing={stowing}
            onCollect={() => collect(false)}
            onCollectNext={() => collect(true)}
          />
        )}

        {/* Build stamp on every phase: the reveal is the screenshot someone
            sends when this screen looks wrong, and the hash answers "which
            build" in one step. 11px floor, muted. */}
        <button
          type="button"
          onClick={handleCopyBuild}
          className="block w-full pb-2 text-center text-micro text-muted-foreground/50 hover:text-muted-foreground"
          aria-label={tFallback('capsuleOpener.copyBuildDiagnosticInfo', 'Copy build diagnostic info to clipboard')}
        >
          {buildLabel()}
        </button>
      </div>
    </div>
  );
}


// ─── The reveal ───────────────────────────────────────────────────────────────
// The plate flips in out of the open canister and slams down; on the hit
// the field churns in the rarity colour, rings and sparks go out, and the screen shakes
// as hard as the rarity earns. Then the name stamps in, the rarity line, the
// set, and last the buttons, each a beat apart, the beat longer the rarer
// the pull. Picking another row in a batch replays a smaller hit.
const PLATE_MS = 560;

const SLAM_IN = [
  { transform: 'perspective(700px) translateY(48px) scale(0.3) rotateY(-120deg)', opacity: 0 },
  { transform: 'perspective(700px) translateY(30px) scale(0.55) rotateY(-80deg)', opacity: 1, offset: 0.2 },
  { transform: 'perspective(700px) translateY(-8px) scale(1.12) rotateY(10deg)', opacity: 1, offset: 0.62 },
  { transform: 'perspective(700px) scale(0.97) rotateY(-3deg)', offset: 0.82 },
  { transform: 'none', opacity: 1 },
];

// The plate tilts under the finger, and on a rare or better the foil band
// follows the tilt. Something to play with on a screen the user lands on a
// hundred times. Transform only, written straight to the element so a drag
// never re-renders the reveal.
const TILT_MAX = 14; // degrees
function usePlateTilt(reduced) {
  const tiltRef = useRef(null);
  const foilRef = useRef(null);
  const set = (rx, ry) => {
    const el = tiltRef.current;
    if (el) el.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    const foil = foilRef.current;
    if (foil) {
      foil.style.opacity = String(Math.min(1, (Math.abs(rx) + Math.abs(ry)) / TILT_MAX));
      foil.style.transform = `translateX(${(ry / TILT_MAX) * 120}%) skewX(-18deg)`;
    }
  };
  const move = (e) => {
    if (reduced || (e.pointerType === 'mouse' && e.buttons === 0)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    const el = tiltRef.current;
    if (el) el.style.transition = 'transform 60ms linear';
    set(-y * TILT_MAX, x * TILT_MAX);
  };
  const release = () => {
    const el = tiltRef.current;
    if (el) el.style.transition = 'transform 520ms cubic-bezier(0.3, 1.5, 0.5, 1)';
    const foil = foilRef.current;
    if (foil) foil.style.transition = 'opacity 400ms ease';
    set(0, 0);
  };
  return {
    tiltRef,
    foilRef,
    handlers: { onPointerDown: move, onPointerMove: move, onPointerUp: release, onPointerLeave: release, onPointerCancel: release },
  };
}

function Reveal({ fx, results, pick, setPick, inv, fmt, tier, next, collecting, stowing, onCollect, onCollectNext }) {
  const { tFallback } = useLanguage();
  const item = results[pick].item;
  const tint = rarityTint(item.rarity);
  const drama = dramaFor(item.rarity);
  const info = describeResult(item, results, inv);
  const variant = item.variant ? VARIANTS[item.variant] : null;
  const price = sellPriceFor(item.rarity, item.variant);
  const isBatch = results.length > 1;
  const plateRef = useRef(null);
  const arrivedRef = useRef(false);
  // The first arrival is the big one; a row pick is a smaller replay.
  const [big] = useState(() => !fx.reduced);
  const firstHit = big ? Math.round(PLATE_MS * 0.62) : 0;
  const tilt = usePlateTilt(fx.reduced);
  const beat = (n) => ({ animationDelay: `${firstHit + (big ? drama.hold : 0) + n * 110}ms` });

  useLayoutEffect(() => {
    const el = plateRef.current;
    if (!el) return undefined;
    const first = !arrivedRef.current;
    arrivedRef.current = true;
    const point = fx.aimAt(el);
    // The field takes this item's colour; a batch's best pull may not be
    // the last capsule cracked, and a row pick walks it to that row's.
    fx.paint({ rarity: item.rarity, mood: 'landed' });
    if (fx.reduced || typeof el.animate !== 'function') return undefined;
    const dur = first ? PLATE_MS : 380;
    el.animate(SLAM_IN, { duration: dur, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'backwards' });
    const t = setTimeout(() => {
      fx.burst(point, item.rarity, { scale: first ? 1 : 0.45, shake: first });
      fx.paint({ stir: first ? drama.stir : drama.stir * 0.5 });
      if (first) {
        const pattern = { legendary: 'success', mythic: 'buzz', animated: 'success' }[item.rarity]
          ?? (rarityRank(item.rarity) >= rarityRank('rare') ? 'primary' : 'subtle');
        triggerHaptic(pattern);
      }
    }, Math.round(dur * 0.62));
    return () => clearTimeout(t);
    // The arrival and each row pick, nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);

  // Collect: the plate drops toward the bag.
  useEffect(() => {
    const el = plateRef.current;
    if (!stowing || !el || fx.reduced || typeof el.animate !== 'function') return;
    el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: 'translateY(-14px) scale(1.04)', opacity: 1, offset: 0.25 },
        { transform: 'translateY(55vh) scale(0.2) rotate(-14deg)', opacity: 0 },
      ],
      { duration: 520, easing: 'cubic-bezier(0.5, 0, 0.85, 0.4)', fill: 'forwards' },
    );
  }, [stowing, fx.reduced]);

  const nextLabel = !next ? null
    : next.tier === 'elite' ? tFallback('capsuleOpener.nextElite', 'Collect and open the next elite')
    : next.tier === 'premium' ? tFallback('capsuleOpener.nextPremium', 'Collect and open the next premium')
    : tFallback('capsuleOpener.nextStandard', 'Collect and open the next standard');

  const stowedLine = isBatch
    ? tFallback('inventoryFlow.addedMany', '{n} items are in your bag.', { n: results.length })
    : tFallback('inventoryFlow.addedOne', '{item} is in your bag.', { item: item.name });

  return (
    <div className="flex-1 flex flex-col" data-tier={tier}>
      {/* Plate, name and set line sit centred in the space above the pinned
          CTAs. Top-aligned, a Pro Max left ~480px of empty stage between the
          set line and Collect. A batch list below keeps them top-aligned,
          because then the list is what fills the space. */}
      <div className={isBatch ? '' : 'flex-1 flex flex-col justify-center'}>
      <div className="flex flex-col items-center gap-4 px-5 pt-3">
        <div ref={plateRef} className="relative touch-none" {...tilt.handlers}>
          <div ref={tilt.tiltRef} className="relative">
          <div
            className="relative rounded-2xl bg-card border flex items-center justify-center overflow-hidden"
            style={{
              width: 'clamp(140px, 24vh, 200px)',
              height: 'clamp(140px, 24vh, 200px)',
              borderColor: tint.color,
            }}
          >
            <Sticker
              itemId={item.id}
              emoji={item.emoji}
              rarity={item.rarity}
              size="70%"
              shadow
              label={item.name}
            />
            {drama.sheen && (
              <span
                key={`sheen-${pick}`}
                className="reveal-sheen absolute inset-y-[-20%] start-0 w-[34%] bg-[#F5F2F0]/15 pointer-events-none"
                style={{ animationDelay: `${firstHit + 80}ms` }}
                aria-hidden="true"
              />
            )}
            {drama.sheen && (
              <span
                ref={tilt.foilRef}
                className="absolute inset-y-[-20%] start-[33%] w-[34%] bg-[#F5F2F0]/15 pointer-events-none"
                style={{ opacity: 0, transform: 'skewX(-18deg)' }}
                aria-hidden="true"
              />
            )}
            <NotchedCorner />
          </div>
          {info.set && (
            <span className="stamp absolute start-3 top-2.5">
              {tFallback('capsules.setNo', 'No. {no}', { no: formatSetNo(info.set.no) })}
            </span>
          )}
          {info.isNew && (
            <span
              key={`new-${pick}`}
              className="reveal-new stamp absolute -top-2.5 -end-4 px-1.5 py-0.5 rounded-sm border-2 border-foreground bg-background text-foreground"
              style={beat(0)}
            >
              {tFallback('capsuleOpener.newStamp', 'New')}
            </span>
          )}
          </div>
        </div>
        <div
          key={`name-${pick}`}
          className="flex flex-col items-center gap-1.5 text-center transition-opacity duration-300"
          style={stowing ? { opacity: 0 } : undefined}
        >
          <span className="reveal-stamp font-display text-display break-anywhere" style={beat(0)}>{item.name}</span>
          <span
            className="reveal-rise flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-body font-semibold"
            style={{ color: tint.color, ...beat(1) }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: tint.color }} aria-hidden="true" />
            {rarityName(tFallback, item.rarity)}
            {variant && <span>{variant.badge}</span>}
            <span className="text-muted-foreground font-medium">{lootDescription(item, tFallback)}</span>
          </span>
        </div>
      </div>

      {/* The fade on Collect sits on a wrapper: the rise's fill would
          otherwise hold the block at full opacity. */}
      <div className="transition-opacity duration-300" style={stowing ? { opacity: 0 } : undefined}>
      <div className="reveal-rise mx-5 mt-5 py-3 border-y flex flex-col gap-2.5" style={beat(2)}>
        {info.set && info.owned != null && (
          <>
            <div className="flex items-center gap-3 h-11 text-label">
              <SetFan items={info.fan} land={info.isNew ? item.id : null} landDelay={firstHit + drama.hold + 400} />
              <span className="flex-1 min-w-0 tabular-nums text-muted-foreground">
                {info.isNew
                  ? tFallback('capsules.set.newInYourSet', 'New. {owned} of {total} in your set', { owned: info.owned, total: info.total })
                  : tFallback('capsules.set.inYourSet', '{owned} of {total} in your set', { owned: info.owned, total: info.total })}
              </span>
            </div>
          </>
        )}
        <div className="flex justify-between text-label text-muted-foreground">
          <span>
            {info.isNew && info.copies === 1
              ? tFallback('capsules.copies.first', 'First copy')
              : tFallback('capsules.copies.have', 'You have {n} copies', { n: info.copies })}
          </span>
          <span className="tabular-nums inline-flex items-center gap-1">
            {tFallback('capsules.sellsFor', 'Sells for')}
            <FlexCoinIcon size={14} />
            <b className="text-foreground font-semibold">{fmt(price)}</b>
          </span>
        </div>
      </div>
      </div>

      </div>

      {isBatch && (
        <div className="reveal-rise px-5 pt-4 flex flex-col" style={beat(3)}>
          <span className="eyebrow pb-1">{tFallback('capsuleOpener.inThisOpen', 'In this open')}</span>
          {results.map((r, i) => {
            const t = rarityTint(r.item.rarity);
            const no = setNumber(r.item.id);
            return (
              <button
                key={r.capsuleId}
                type="button"
                onClick={() => setPick(i)}
                aria-pressed={i === pick}
                className="h-14 border-t flex items-center gap-2 text-start"
              >
                <span
                  className="w-[3px] h-7 rounded-full me-1"
                  style={{ background: i === pick ? 'hsl(var(--foreground))' : 'transparent' }}
                  aria-hidden="true"
                />
                <Sticker itemId={r.item.id} emoji={r.item.emoji} rarity={r.item.rarity} size={40} className="me-1" />
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-body font-semibold truncate">{r.item.name}</span>
                  <span className="text-caption" style={{ color: t.color }}>{rarityName(tFallback, r.item.rarity)}</span>
                </span>
                {no && (
                  <span className="stamp">{tFallback('capsules.setNo', 'No. {no}', { no: formatSetNo(no.no) })}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Pinned CTAs. The spacer keeps the last row clear of them. */}
      <div className="h-6 shrink-0" />
      {/* The rise animates an inner block, never the sticky one: a sticky
          element under a transform animation got its own layer, and the
          compositor drew a copy of that layer over the header. Only a batch,
          whose list scrolls under the buttons, needs the band filled. */}
      <div className={`sticky bottom-0 mt-auto px-5 pt-3 pb-3 ${isBatch ? 'bg-background' : ''}`}>
      <div className="reveal-rise flex flex-col gap-1" style={beat(3)}>
        {stowing ? (
          <p className="reveal-rise h-14 flex items-center justify-center text-body font-semibold" role="status" style={{ animationDelay: '260ms' }}>
            {stowedLine}
          </p>
        ) : (
          <button
            type="button"
            onClick={onCollect}
            disabled={collecting}
            className="h-14 rounded-full bg-primary text-primary-foreground font-display text-title disabled:opacity-60"
          >
            {isBatch
              ? tFallback('capsuleOpener.collectAll', 'Collect all {n}', { n: results.length })
              : tFallback('capsuleOpener.collect', 'Collect')}
          </button>
        )}
        {nextLabel && (
          <button
            type="button"
            onClick={onCollectNext}
            disabled={collecting}
            className="h-11 text-label font-semibold text-foreground disabled:opacity-60"
            style={stowing ? { visibility: 'hidden' } : undefined}
          >
            {nextLabel}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
