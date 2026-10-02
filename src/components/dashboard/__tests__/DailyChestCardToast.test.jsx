// The daily chest's success toast. Its description ("+75 coins · 1 standard
// capsule") was a hardcoded English template literal, so it stayed English
// under every language (audit, 2026-09-30). The stub below IGNORES the English
// fallback and interpolates a catalog template, which is the only way a test
// can tell a translated string with its vars from a pre-interpolated one.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CATALOG = {
  'marketplace.dailyChest.claimSuccess': 'Cofre diario reclamado',
  'marketplace.dailyChest.claimSuccessBody': '+{coins} monedas · 1 Capsule estándar',
};
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (k, en, vars) => {
      const tpl = CATALOG[k] ?? en;
      return vars ? tpl.replace(/\{(\w+)\}/g, (_, n) => vars[n]) : tpl;
    },
  }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }) }));
const success = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { success: (...a) => success(...a), message: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: { coins_awarded: 120, new_balance: 500 }, error: null })) },
}));
vi.mock('@/lib/inventoryFlow', () => ({ requestOpenBag: vi.fn() }));
vi.mock('@/lib/dailyChest', () => ({ isDailyChestReady: () => true, announceDailyChestClaimed: vi.fn() }));
vi.mock('@/api/profileCache', () => ({ getProfile: () => ({}), patchProfile: vi.fn() }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

import DailyChestCard from '../DailyChestCard';

describe('DailyChestCard claim toast', () => {
  it('translates the reward line and fills in the coins the server awarded', async () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><DailyChestCard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    const [title, opts] = success.mock.calls[0];
    expect(title).toBe('Cofre diario reclamado');
    expect(opts.description).toBe('+120 monedas · 1 Capsule estándar');
  });
});
