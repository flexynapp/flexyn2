// src/hooks/useUrlState.js
//
// A page's current tab or sub-view, kept in the URL as well as in state.
//
//   const [tab, setTab] = useUrlState('tab', 'trends', ['trends', 'records']);
//
// Why (navigation redesign, phase 1): every page but Settings held its
// sub-view in local state only. Refresh, a shared link, or leaving the tab
// and coming back all dropped you on the page's default view, which is a
// large part of why the app feels easy to get lost in. With the view in
// the URL, the bottom bar can reopen a tab exactly where it was left
// (Layout remembers each tab's last URL) and a refresh keeps your place.
//
// Rules the hook follows:
// - Switching views REPLACES the history entry. A segmented control is
//   not a page; making each tap a Back step would turn Back into an undo
//   button for tab switches, which no platform does.
// - The default view writes no param, so plain URLs stay plain.
// - Unknown values are ignored, so a stale or hand-typed link can never
//   select a view that renders nothing.
// - Several pages strip their own one-shot params with
//   navigate(pathname, { replace: true }), which also drops ours. That is
//   not the user changing view, so the param is written back. Only a POP
//   (Back / Forward) without the param is taken to mean "the default view".
// - The setter accepts a value or an updater function, like useState.
// - Coming back to the app opens the default view: a fresh launch ignores
//   a restored param, and a long stay in the background resets to it.
//   A refresh still keeps your place. See src/lib/appResume.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { isRestoredLaunchUrl, onLongResume } from '@/lib/appResume';

function readParam(search, param, allowed) {
  const v = new URLSearchParams(search).get(param);
  if (v == null) return null;
  return !allowed || allowed.includes(v) ? v : null;
}

export function useUrlState(param, initial, allowed) {
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();

  const [value, setValue] = useState(() => (
    isRestoredLaunchUrl(location) ? initial : (readParam(location.search, param, allowed) ?? initial)
  ));

  useEffect(() => onLongResume(() => setValue(initial)), [initial]);

  // Latest value for the URL effect, without making it re-run on every set.
  const valueRef = useRef(value);
  valueRef.current = value;
  const locRef = useRef(location);
  locRef.current = location;

  const writeUrl = useCallback((next) => {
    const loc = locRef.current;
    const params = new URLSearchParams(loc.search);
    if (next === initial || next == null) params.delete(param);
    else params.set(param, next);
    const search = params.toString() ? `?${params.toString()}` : '';
    if (search === loc.search) return;
    // Router state is NOT carried over. Pages consume hand-offs from it and
    // then clear it behind the router's back (history.replaceState), so the
    // router's copy is stale; re-sending it would replay the hand-off.
    navigate({ pathname: loc.pathname, search, hash: loc.hash }, { replace: true, state: null });
  }, [navigate, param, initial]);

  // URL → state: a link or Back/Forward that names a view selects it.
  useEffect(() => {
    // A relaunch restored this URL; the state→URL effect is clearing it.
    if (isRestoredLaunchUrl(location)) return;
    const fromUrl = readParam(location.search, param, allowed);
    if (fromUrl != null) {
      if (fromUrl !== valueRef.current) setValue(fromUrl);
      return;
    }
    if (navType === 'POP') {
      if (valueRef.current !== initial) setValue(initial);
      return;
    }
    // The page rewrote its URL and dropped our param: put it back.
    if (valueRef.current !== initial) writeUrl(valueRef.current);
    // `allowed` is a literal at every call site; its identity is irrelevant.
  }, [location.search, navType, param, initial, writeUrl]);

  // state → URL.
  useEffect(() => {
    if (readParam(locRef.current.search, param, allowed) === (value === initial ? null : value)) return;
    writeUrl(value);
  }, [value]);

  return [value, setValue];
}

export default useUrlState;
