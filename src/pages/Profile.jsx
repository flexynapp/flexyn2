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

import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useStartConversation } from '@/lib/hubMessaging';
import HubProfile from '@/components/hub/HubProfile';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const startConversation = useStartConversation();

  return (
    <div className="px-4 md:px-8 max-w-3xl mx-auto py-4">
      <ErrorBoundary label="Profile">
        <HubProfile
          email={user?.email}
          onBack={() => navigate(-1)}
          onStartConversation={startConversation}
          onViewProfile={(email) => navigate(`/hub?profile=${encodeURIComponent(email)}`)}
        />
      </ErrorBoundary>
    </div>
  );
}
