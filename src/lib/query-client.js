import { QueryClient } from '@tanstack/react-query';

// staleTime default = 60s. Without it Tanstack treats every query as
// instantly stale and refetches on every component mount, hammering the
// DB and causing jank on tab switches. Queries that need fresher data
// (notifications, push subscriptions) override per-query with a smaller
// staleTime; queries with quasi-static data (profile, regimens,
// achievements) inherit the default.
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 60_000,
		},
	},
});

export function clearQueryCache() {
  queryClientInstance.clear();
}