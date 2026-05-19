// src/pages/Coach.jsx
// Standalone AI Coach route — previously buried behind a Sparkles icon
// in Hub's sub-header. CoachChat is self-contained (no props, history
// in localStorage), so this wrapper just gives it a page chrome.

import CoachChat from '@/components/coach/CoachChat';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useLanguage } from '@/lib/LanguageContext';

export default function Coach() {
  const { t } = useLanguage();
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight mb-4 hidden lg:block">
        {t('hub.coach.title') || 'AI Coach'}
      </h1>
      <ErrorBoundary label="Coach">
        <CoachChat />
      </ErrorBoundary>
    </div>
  );
}
