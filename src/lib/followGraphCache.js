// Every cache that holds a slice of the viewer's follow graph.
//
// The follow list is registered under more than one key: ['hubFollowing',
// <id>] (HubFeed, FollowerActivityBanner, useHubUnreadDot, HubProfile's own
// lists), ['hubFollowingIds', <id>] (stories, suggestions), and the feeds
// built from it. react-query matches keys element by element and says
// nothing when an invalidation matches no query, so a surface that follows
// or blocks someone and invalidates one shape leaves the others stale, and
// the new follow does not show up where the user looks next. Each prefix
// below matches every entry under that name, whoever's id is in slot 1.
export function invalidateFollowGraph(queryClient) {
  if (!queryClient) return;
  queryClient.invalidateQueries({ queryKey: ['hubFollowing'] });
  queryClient.invalidateQueries({ queryKey: ['hubFollowingIds'] });
  queryClient.invalidateQueries({ queryKey: ['hubFollowers'] });
  queryClient.invalidateQueries({ queryKey: ['hubFollowingLatest'] });
  queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
}
