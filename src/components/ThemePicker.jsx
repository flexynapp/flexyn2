// src/components/ThemePicker.jsx
// Compact appearance toggle (Light / Dark) embedded in the ProfileMenu.
// Color / theme selection has moved to the dedicated ThemeSelector modal
// accessible from the Hub profile — see ThemeSelector.jsx.
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/lib/ThemeContext';

export default function ThemePicker() {
  const { darkMode, setDarkMode } = useTheme();

  return (
    <div className="px-4 py-3 border-t border-border">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Appearance</p>
      <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Light or dark appearance">
        <button
          onClick={() => setDarkMode(false)}
          aria-pressed={!darkMode}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            !darkMode ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-muted-foreground'
          }`}
        >
          <Sun className="w-3.5 h-3.5" /> Light
        </button>
        <button
          onClick={() => setDarkMode(true)}
          aria-pressed={darkMode}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            darkMode ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-muted-foreground'
          }`}
        >
          <Moon className="w-3.5 h-3.5" /> Dark
        </button>
      </div>
    </div>
  );
}
