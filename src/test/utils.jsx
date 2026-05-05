/**
 * Custom render helper.
 *
 * Wraps components with the providers they need so individual tests
 * don't have to set up context boilerplate. Add new providers here as
 * the app grows.
 *
 * Usage:
 *   import { render } from '@/test/utils';
 *   render(<MyComponent />);
 */

import React from 'react';
import { render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Don't retry in tests — failures should be immediate
        retry: false,
        // Don't cache between tests
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
}

function AllProviders({ children }) {
  const queryClient = makeQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

function render(ui, options) {
  return rtlRender(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything from testing-library so tests only need one import
export * from '@testing-library/react';
export { render };
