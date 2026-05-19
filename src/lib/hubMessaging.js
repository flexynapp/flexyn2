// src/lib/hubMessaging.js
// Shared messaging primitives lifted out of Hub.jsx so the new /messages
// and /market routes (and any other caller) can start conversations and
// read the unread-DM count without duplicating the orchestration.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';

// Global unread DM count. Single source of truth — header and any
// future surface should read from this hook. Cadence matches the
// previous in-Hub poll (15s) so the header badge feels live without
// hammering the DB on every route change.
export function useUnreadDMCount() {
  const { user } = useAuth();
  const { data = 0 } = useQuery({
    queryKey: ['hubUnreadCount', user?.email],
    queryFn: () => hubMessages.unreadCountFor(user.email),
    enabled: !!user?.email,
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
  const { t } = useLanguage();
  const navigate = useNavigate();

  return useCallback(async (targetUserObj) => {
    if (!user?.email) {
      toast.error(t('hub.messages.authNotReady') || 'Still signing you in — try again in a moment.');
      return;
    }
    if (!targetUserObj?.email) {
      console.error('[hubMessaging] start called without target email');
      return;
    }
    try {
      const conv = await hubMessages.findOrCreateConversation(user.email, targetUserObj.email);
      if (!conv) {
        toast.error(t('hub.messages.startError') || 'Could not start conversation. Try again.');
        throw new Error('no-conversation');
      }
      navigate('/messages', {
        state: { pendingChatTarget: { conversation: conv, otherUser: targetUserObj } },
      });
    } catch (e) {
      if (e?.message !== 'no-conversation') {
        console.error('[hubMessaging] startConversation failed:', e);
        toast.error(t('hub.messages.startError') || 'Could not start conversation. Try again.');
      }
      throw e;
    }
  }, [user?.email, t, navigate]);
}
