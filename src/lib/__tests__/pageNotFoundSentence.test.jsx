// One real TransText call site, rendered end to end.
//
// TransText's own tests use a stub tFallback, which proves the substitution but
// not that a converted sentence still reads the way it did as JSX. This renders
// the actual component against the actual catalog and asserts the whole
// sentence, including the quotes and the styling that used to sit in the markup.
//
// PageNotFound was picked because it is the one converted site reachable with
// almost no scaffolding — everything else in this pass lives behind auth.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PageNotFound from '../PageNotFound';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/api/db', () => ({ db: { auth: { me: () => Promise.reject(new Error('signed out')) } } }));

const show = (path) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><PageNotFound /></MemoryRouter>
  </QueryClientProvider>,
);

describe('PageNotFound — a converted sentence', () => {
  it('reads exactly as it did before the sentence became one key', () => {
    show('/nope');
    expect(
      screen.getByText((_, el) => el?.tagName === 'P'
        && el.textContent.replace(/\s+/g, ' ').trim()
          === 'The page "nope" could not be found in this application.'),
    ).toBeTruthy();
  });

  it('keeps the page name styled — the thing folding it into one key would have cost', () => {
    show('/nope');
    const styled = document.querySelector('span.font-medium.text-foreground');
    expect(styled, 'the interpolated name lost its styling').toBeTruthy();
    expect(styled.textContent).toBe('"nope"');
  });

  it('puts the name where the TEMPLATE puts it, not where the JSX used to', () => {
    // The property that made this worth doing: the catalog decides word order.
    // If the sentence were still split across a key and an element, a locale
    // that leads with the name could not express it.
    show('/nope');
    const p = document.querySelector('p.text-muted-foreground');
    expect(p.textContent.indexOf('The page')).toBeLessThan(p.textContent.indexOf('"nope"'));
  });
});
