// src/components/hub/profile/ProfileTabs.jsx
//
// Stats / Trophies / Posts.
//
// These were five sections pretending to be one page: lift stats, badges,
// completion meter, referral card, two trophy blocks and the post list, all
// stacked with mb-4. Tabs give each of them room instead of taking it away —
// nothing is hidden that wasn't already below the fold.
//
// Deliberately NOT sticky. Hub.jsx renders a *fixed* sub-header whose height
// changes by section (a full title row on the feed, a compact back button on
// a profile), so any hardcoded sticky offset would collide with it in one
// state or the other. Scrolling with the content is the honest version until
// the profile owns its own scroll container.
const TAB_BASE =
  'flex-1 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-t';

export default function ProfileTabs({ tabs, active, onChange }) {
  const onKeyDown = (e) => {
    const i = tabs.findIndex((tab) => tab.id === active);
    if (i < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(tabs[(i + 1) % tabs.length].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Profile sections"
      onKeyDown={onKeyDown}
      className="flex border-b border-border mb-4"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={`profile-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`profile-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`${TAB_BASE} ${
              selected
                ? 'text-foreground border-primary'
                : 'text-muted-foreground border-transparent hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="ms-1.5 text-xs text-muted-foreground tabular-nums">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ProfileTabPanel({ id, active, children }) {
  if (id !== active) return null;
  return (
    <div
      role="tabpanel"
      id={`profile-panel-${id}`}
      aria-labelledby={`profile-tab-${id}`}
      tabIndex={0}
      className="focus:outline-none"
    >
      {children}
    </div>
  );
}
