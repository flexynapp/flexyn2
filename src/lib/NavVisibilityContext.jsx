// src/lib/NavVisibilityContext.jsx
//
// Broadcasts the bottom-nav's auto-hide state (from Layout) so floating
// elements — e.g. the Hub "New Post" FAB — can slide down to the wall when the
// nav hides on scroll-down, and back up when it reappears.

import { createContext, useContext } from 'react';

// value = navHidden (boolean)
export const NavVisibilityContext = createContext(false);

export const useNavHidden = () => useContext(NavVisibilityContext);
