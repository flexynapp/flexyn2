import { useNavigate, useLocation } from 'react-router-dom';
import { LOGO_URL } from '@/lib/constants';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import ProfileMenu from './ProfileMenu';
import LevelBar from './LevelBar';
import NotificationBell from './NotificationBell';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';

const CHILD_ROUTES = ['/workout', '/progress', '/nutrition'];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [titleOverride, setTitleOverride] = useState(null);

  // Listen for cardio-mode title overrides dispatched by CardioSection
  useEffect(() => {
    const handler = (e) => setTitleOverride(e.detail?.title || null);
    window.addEventListener('flexyn-title', handler);
    return () => window.removeEventListener('flexyn-title', handler);
  }, []);

  // Reset override when the route changes
  useEffect(() => {
    setTitleOverride(null);
  }, [location.pathname]);

  const ROUTE_TITLES = {
    '/workout': t('nav.workout'),
    '/progress': t('nav.progress'),
    '/nutrition': t('nav.nutrition'),
  };

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => base44.auth.me(),
    enabled: !!user?.email,
  });



  const isChildRoute = CHILD_ROUTES.includes(location.pathname);
  const title = titleOverride || ROUTE_TITLES[location.pathname] || t('app.name');

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card/80 backdrop-blur-md border-b border-border select-none-ui"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center h-14 px-3">
        {isChildRoute ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => {
              // Give the current page a chance to intercept back navigation
              // (e.g. an active workout should reset state instead of routing
              // away). If nothing calls preventDefault, fall through to /dashboard.
              const event = new CustomEvent('flexyn-back', { cancelable: true });
              window.dispatchEvent(event);
              if (!event.defaultPrevented) navigate('/dashboard');
            }}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
        ) : (
          <button
            onClick={() => navigate('/dashboard')}
            className="w-9 h-9 rounded-xl overflow-hidden shrink-0 hover:opacity-80 transition-opacity"
          >
            <img src="{LOGO_URL}" alt="Flexyn" className="w-full h-full object-contain" />
          </button>
        )}
        <button
          onClick={() => navigate('/dashboard')}
          className="font-heading font-bold text-lg tracking-tight flex-1 text-left hover:opacity-80 transition-opacity px-2 whitespace-nowrap"
        >
          {isChildRoute ? title : t('app.name')}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <NotificationBell />
          <LevelBar totalXp={userProfile?.total_xp || 0} compact={true} />
          <div className="-ml-2">
            <ProfileMenu />
          </div>
        </div>
      </div>

    </header>
  );
}