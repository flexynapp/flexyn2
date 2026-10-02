// src/lib/hubMessaging.js
// Shared messaging primitives lifted out of Hub.jsx so the new /messages
// and /market routes (and any other caller) can start conversations and
// read the unread-DM count without duplicating the orchestration.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import { reportError } from '@/lib/reportError';

// Global unread DM count. Single source of truth — header and any
// future surface should read from this hook. Cadence matches the
// previous in-Hub poll (15s) so the header badge feels live without
// hammering the DB on every route change.
export function useUnreadDMCount() {
  const { user } = useAuth();
  const { data = 0 } = useQuery({
    queryKey: ['hubUnreadCount', user?.email],
    queryFn: () => hubMessages.unreadCountFor(user.id),
    enabled: !!user?.email && !!user?.id,
    refetchInterval: 15_000,
    staleTime: 0,
  });
  return data;
}

// Returns a callback: `start(targetUser) => Promise<void>` that
// finds or creates a conversation with `targetUser` and navigates
// to /messages with the conversation pre-selected via router state.
// Messages.jsx reads `location.state.pendingChatTarget` to open it.
export function useStartConversation() {
  const { user } = useAuth();
  // `t` was in the deps and `tFallback` — the function actually called — was
  // not, so every toast in here kept whichever language was active when the
  // callback was first built.
  const { tFallback } = useLanguage();
  const navigate = useNavigate();

  return useCallback(async (targetUserObj) => {
    if (!user?.email) {
      toast.error(tFallback('hub.messages.authNotReady', 'Still signing you in. Try again in a moment.'));
      return;
    }
    // Accept an id OR an email. The id is present synchronously on every
    // nav target, and findOrCreateConversation hands it to the server, which
    // looks the email up itself, so the app never holds the other person's
    // address. An email is only passed by the marketplace.
    const targetKey = targetUserObj?.id ?? targetUserObj?.email ?? null;
    if (!targetKey) {
      // Previously a bare console.error + return. A user-initiated tap
      // that does NOTHING — no toast, no spinner, no navigation — is its
      // own defect regardless of cause, so this is now loud in the UI and
      // reported for diagnosis.
      const err = new Error('startConversation called without a target id or email');
      reportError(err, {
        feature: 'dm.start',
        level: 'warning',
        userEmail: user?.email,
        target: (() => { try { return JSON.stringify(targetUserObj)?.slice(0, 200); } catch { return String(targetUserObj); } })(),
      });
      toast.error(tFallback('hub.messages.startError', 'Could not start conversation. Try again.'));
      return;
    }
    try {
      const conv = await hubMessages.findOrCreateConversation(user.email, targetKey);
      if (!conv) {
        toast.error(tFallback('hub.messages.startError', 'Could not start conversation. Try again.'));
        throw new Error('no-conversation');
      }
      navigate('/messages', {
        state: { pendingChatTarget: { conversation: conv, otherUser: targetUserObj } },
      });
    } catch (e) {
      if (e?.message !== 'no-conversation') {
        console.error('[hubMessaging] startConversation failed:', e);
        toast.error(tFallback('hub.messages.startError', 'Could not start conversation. Try again.'));
      }
      throw e;
    }
  }, [user?.email, tFallback, navigate]);
}
