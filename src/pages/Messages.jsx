// src/pages/Messages.jsx
// Standalone Messages route — replaces the old Hub state-machine view.
// Reads `location.state.pendingChatTarget` so callers (Market listings,
// HubProfile "Message" button, etc.) can deep-link a conversation open.

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HubMessages from '@/components/hub/HubMessages';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useLanguage } from '@/lib/LanguageContext';

export default function Messages() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingChatTarget, setPendingChatTarget] = useState(
    location.state?.pendingChatTarget || null
  );

  // Strip the router state after consuming it so a hard reload doesn't
  // keep re-opening the same conversation.
  useEffect(() => {
    if (location.state?.pendingChatTarget) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight mb-4 hidden lg:block">
        {t('hub.messages.title') || 'Messages'}
      </h1>
      <ErrorBoundary label="Messages">
        <HubMessages
          pendingChatTarget={pendingChatTarget}
          onPendingConsumed={() => setPendingChatTarget(null)}
        />
      </ErrorBoundary>
    </div>
  );
}
