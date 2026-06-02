// src/lib/data/layoutDefaults.js
//
// App-wide default layouts for the reorderable surfaces (Dashboard /
// Workout / Nutrition). Admin presses "Set as default layout" → we
// snapshot their current widget_order + section_layouts to
// app_layout_defaults (mig 166). New users (and Reset) read from
// here as a fallback before the in-code DEFAULT_* constants.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


export async function getLayoutDefault(surface) {
  if (!surface) return null;
  try {
    const { data, error } = await safeSelect({
    columns: ['widget_order', 'section_layouts', 'updated_at'],
    build: (cols) => supabase
      .from('app_layout_defaults')
      .select(cols)
      .eq('surface', surface)
      .maybeSingle(),
  });
    if (error) {
      // 42P01 = table missing (migration not deployed yet) — silent.
      if (error.code === '42P01') return null;
      return null;
    }
    return data || null;
  } catch {
    return null;
  }
}

export async function setLayoutDefault(surface, widgetOrder, sectionLayouts = null) {
  const { data, error } = await supabase.rpc('set_layout_default', {
    p_surface: surface,
    p_widget_order: widgetOrder,
    p_section_layouts: sectionLayouts,
  });
  if (error) {
    const msg = error.message || '';
    if (error.code === '42883' || error.code === '42P01' || /undefined_function|unknown_function/.test(msg)) {
      return { ok: false, error: 'rpc_missing' };
    }
    if (/admin_only/.test(msg))       return { ok: false, error: 'admin_only' };
    if (/invalid_surface/.test(msg))  return { ok: false, error: 'invalid_surface' };
    if (/unauthenticated/.test(msg))  return { ok: false, error: 'not_authenticated' };
    return { ok: false, error: msg || 'rpc_failed' };
  }
  return { ok: true, data };
}
