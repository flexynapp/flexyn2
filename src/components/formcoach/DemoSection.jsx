import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

export default function DemoSection() {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-6 border border-border rounded-xl overflow-hidden bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-secondary active:bg-secondary transition-colors text-start"
      >
        <div>
          <p className="font-medium text-sm">{t('formcoach.howItWorks')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('formcoach.positionYourself')}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border space-y-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Good positioning example */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-green-600">{t('formcoach.goodAngle')}</p>
              <div className="bg-muted rounded-lg p-3 aspect-video flex items-center justify-center text-xs text-muted-foreground">
                <div className="text-center">
                  <p className="font-medium mb-1">{t('formcoach.goodAngleDesc')}</p>
                  <p className="text-xs">{t('formcoach.fullBody')}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('formcoach.goodAngleCaption')}</p>
            </div>

            {/* Tips */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-blue-600">{t('formcoach.tips')}</p>
              <ul className="text-xs space-y-1.5 text-muted-foreground">
                <li>{t('formcoach.tip1')}</li>
                <li>{t('formcoach.tip2')}</li>
                <li>{t('formcoach.tip3')}</li>
                <li>{t('formcoach.tip4')}</li>
              </ul>
            </div>
          </div>

          <div className="bg-accent/10 rounded-lg p-3 text-xs text-accent-foreground">
            <p className="font-medium mb-1">{t('formcoach.howAnalysisWorks')}</p>
            <p>{t('formcoach.howAnalysisDesc')}</p>
          </div>
        </div>
      )}
    </div>
  );
}