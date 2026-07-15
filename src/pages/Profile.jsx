// src/pages/Profile.jsx
// Dedicated /profile route — shows the current user's own Hub profile
// without going through the Hub feed. Replaces the old ProfileMenu
// navigate('/hub?profile=email') which caused a double-click bug on
// desktop: the Hub component's reset effect (`setSection('feed')`)
// fired AFTER the profile-param effect, collapsing the profile view
// back to the feed on the first click.
//
// Now ProfileMenu navigates directly here, the profile opens immediately
// on the first click with no intermediate feed state.
//
// HubProfile is the underlying component. Its prop contract is
// `{ targetUser, onSelectUser, onStartConversation }` — we leave
// targetUser undefined (HubProfile resolves to self when not provided)
// and wire onSelectUser so outbound taps (post-author tap, followers /
// following modal taps) navigate to the tapped user's Hub profile.
// A previous version of this file passed `onViewProfile` (a prop
// HubProfile doesn't read), silently breaking every outbound link
// from /profile.

import { useNavigate } from 'react-router-dom';
import { useStartConversation } from '@/lib/hubMessaging';
import HubProfile from '@/components/hub/HubProfile';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function Profile() {
  const navigate = useNavigate();
  const startConversation = useStartConversation();

  // Outbound profile-tap → route to the Hub profile view for that user.
  // Hub.jsx reads the `?profile=` query param and opens the profile
  // subview directly; if the tapped user is the signed-in user, Hub
  // collapses it back to /profile via the same handler.
  const handleSelectUser = (selectedUser) => {
    // Prefer user_id (id-keyed profile route); fall back to email for any
    // payload that doesn't carry an id yet.
    const target = selectedUser?.id || selectedUser?.email;
    if (!target) return;
    navigate(`/hub?profile=${encodeURIComponent(target)}`);
  };

  return (
    <div className="px-4 md:px-8 max-w-3xl mx-auto py-4">
      <ErrorBoundary label="Profile">
        <HubProfile
          onSelectUser={handleSelectUser}
          onStartConversation={startConversation}
        />
      </ErrorBoundary>
    </div>
  );
}
