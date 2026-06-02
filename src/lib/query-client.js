import { QueryClient } from '@tanstack/react-query';

// staleTime default = 60s. Without it Tanstack treats every query as
// instantly stale and refetches on every component mount, hammering the
// DB and causing jank on tab switches. Queries that need fresher data
// (notifications, push subscriptions) override per-query with a smaller
// staleTime; queries with quasi-static data (profile, regimens,
// achievements) inherit the default.
//
// refetchOnWindowFocus stays TRUE (default). Tanstack only refetches a
// query on focus when it's past its staleTime, so the 60s default
// above gates the cost — a tab refocus within 60s of the last fetch
// is a no-op, while a return after backgrounding for the night
// catches the user up on what they missed. The previous explicit
// `refetchOnWindowFocus: false` left a Dashboard left open over a
// dinner break showing hour-old workout counts until the user
// manually pulled to refresh.
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			staleTime: 60_000,
		},
	},
});

export function clearQueryCache() {
  queryClientInstance.clear();
}