// src/components/AccountMenu.jsx
//
// The account menu: the four things that are about your ACCOUNT rather than
// your training. View profile, Settings, Language, Sign out, plus one row
// that points at You, where everything else lives.
//
// It used to be a nine-row copy of the You tab (Achievements, My Bag, My Gym,
// My Journal, Weekly Reviews, My Injuries...) that had drifted from it: the
// menu lacked Progress, Nutrition and Market, You lacked Profile, and the two
// disagreed on icons. Every one of those rows is still one tap away, under
// the You row here and on the You page itself, grouped with headings.
//
// Rendered two ways by ProfileMenu: a popover that opens upward from the
// account row at the foot of the desktop sidebar, and a bottom sheet from the
// phone header's avatar. Same content, same order, so the two cannot drift.
//
// Keyboard: it is a real menu. Focus moves to the first item on open, arrow
// keys and Home/End move between items, Escape closes (ProfileMenu returns
// focus to the trigger).

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Globe, LogOut, Settings, UserCircle, LayoutGrid } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { useGlobalRank } from '@/hooks/useGlobalRank';
import { useNumberFormatter } from '@/lib/intl';
import { handle } from '@/lib/userDisplay';
import ProfileAvatar from './ProfileAvatar';

const ITEM = 'w-full min-h-11 flex items-center gap-2 px-3 rounded-lg text-start text-body transition-colors hover:bg-secondary active:bg-secondary focus-visible:outline-none focus-visible:bg-secondary';

function Item({ icon: Icon, label, hint, value, count, onClick, chevron = true, tone }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`${ITEM} ${hint ? 'py-2' : ''} ${tone === 'danger' ? 'text-destructive' : ''}`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${tone === 'danger' ? '' : 'text-muted-foreground'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block font-medium truncate">{label}</span>
        {hint && <span className="block text-label text-muted-foreground">{hint}</span>}
      </span>
      {value && <span className="text-label text-muted-foreground shrink-0">{value}</span>}
      {count > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center tabular-nums shrink-0">
          {count > 9 ? '9+' : count}
        </span>
      )}
      {chevron && tone !== 'danger' && (
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * @param {object}   props
 * @param {object}   props.user          profile from db.auth.me()
 * @param {number}   props.capsuleCount  unopened capsules, shown on the You row
 * @param {boolean}  props.open          whether the menu is showing (gates the rank query)
 * @param {Function} props.onNavigate    (path) => void, closes the menu and routes
 * @param {Function} props.onOpenStats   opens the Stats Hub
 * @param {Function} props.onSignOut     opens the sign-out confirmation
 * @param {Function} props.onClose       closes the menu (Escape)
 */
export default function AccountMenu({ user, capsuleCount = 0, open = true, onNavigate, onOpenStats, onSignOut, onClose }) {
  const { t, tFallback, language, setLanguage, SUPPORTED_LANGUAGES, currentLanguage } = useLanguage();
  const fmt = useNumberFormatter();
  const [view, setView] = useState('main');
  const listRef = useRef(null);

  const { level } = calculateLevelFromXp(user?.total_xp || 0);
  const { rank } = useGlobalRank({ enabled: open });

  // Focus the first item whenever the menu opens or switches view, so the
  // keyboard lands inside it rather than on the page behind.
  useEffect(() => {
    if (!open) return;
    const first = listRef.current?.querySelector('[role="menuitem"], [role="menuitemradio"]');
    first?.focus({ preventScroll: true });
  }, [open, view]);

  useEffect(() => { if (!open) setView('main'); }, [open]);

  const onKeyDown = (e) => {
    const items = [...(listRef.current?.querySelectorAll('[role="menuitem"], [role="menuitemradio"]') || [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (view !== 'main') setView('main'); else onClose?.();
      return;
    }
    if (next) { e.preventDefault(); next.focus(); }
  };

  const showLanguage = SUPPORTED_LANGUAGES.length > 1;
  const name = user?.full_name || handle(user) || tFallback('profile.account', 'Profile');

  return (
    <div
      ref={listRef}
      role="menu"
      aria-label={tFallback('profileMenu.account', 'Account')}
      onKeyDown={onKeyDown}
      data-portal-ignore-outside-click
      className="flex flex-col"
    >
      {view === 'main' ? (
        <>
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <ProfileAvatar user={user} size={40} />
            <div className="flex-1 min-w-0">
              <p className="font-heading font-bold text-body truncate">{name}</p>
              {/* The level line is the old level chip's job, without the chip:
                  it still opens the Stats Hub. The underline-on-hover and the
                  chevron say it is tappable, which the glowing chip never did. */}
              <button
                type="button"
                onClick={onOpenStats}
                aria-label={tFallback('profileMenu.openStats', 'Open your stats')}
                className="group inline-flex items-center gap-1 min-h-6 text-label text-muted-foreground tabular-nums rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-heading font-bold text-foreground">{t('levelBar.level', { n: level })}</span>
                {rank != null && <><span aria-hidden="true">·</span><span className="group-hover:underline">#{fmt(rank)}</span></>}
                <ChevronRight className="w-3 h-3 rtl:scale-x-[-1]" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex flex-col px-1 pb-1">
            <Item icon={UserCircle} label={tFallback('profileMenu.viewProfile', 'View profile')} onClick={() => onNavigate('/profile')} />
            <Item
              icon={LayoutGrid}
              label={tFallback('nav.you', 'You')}
              hint={tFallback('profileMenu.youHint', 'Progress, rewards, gym and journal')}
              count={capsuleCount}
              onClick={() => onNavigate('/you')}
            />
            <Item icon={Settings} label={tFallback('profile.settings', 'Settings')} onClick={() => onNavigate('/settings')} />
            {showLanguage && (
              <Item
                icon={Globe}
                label={tFallback('profileMenu.language', 'Language')}
                value={currentLanguage?.nativeLabel}
                onClick={() => setView('language')}
              />
            )}
          </div>

          <div className="flex flex-col px-1 py-1 border-t border-border">
            <Item icon={LogOut} label={tFallback('profile.signOut', 'Sign out')} onClick={onSignOut} tone="danger" />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col px-1 pt-1">
            <button type="button" role="menuitem" onClick={() => setView('main')} className={`${ITEM} font-heading font-bold`}>
              <ChevronLeft className="w-5 h-5 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
              {tFallback('profileMenu.language', 'Language')}
            </button>
          </div>
          <div className="flex flex-col px-1 pb-1 max-h-72 overflow-y-auto">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                role="menuitemradio"
                aria-checked={language === lang.code}
                onClick={() => { setLanguage(lang.code); setView('main'); }}
                className={`${ITEM} py-2`}
              >
                <span className="w-5 text-center shrink-0" aria-hidden="true">{lang.flag}</span>
                {/* Native name first, English second: this is the one list a
                    person who cannot read the current language must be able
                    to use. */}
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">{lang.nativeLabel}</span>
                  <span className="block text-label text-muted-foreground">{lang.label}</span>
                </span>
                {language === lang.code && <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
