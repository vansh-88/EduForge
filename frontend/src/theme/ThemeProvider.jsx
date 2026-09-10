import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext, STORAGE_KEY, THEME_PREFERENCES } from './themeContext';

const prefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-color-scheme: dark)').matches;

const readStoredPreference = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEME_PREFERENCES.includes(stored) ? stored : 'system';
  } catch {
    // Private mode, or blocked site data. Following the OS is a fine default.
    return 'system';
  }
};

/** The preference resolved against the OS: always 'light' or 'dark'. */
const resolve = (preference) =>
  preference === 'system' ? (prefersDark() ? 'dark' : 'light') : preference;

const applyTheme = (resolved) => {
  document.documentElement.dataset.theme = resolved;
};

export const ThemeProvider = ({ children }) => {
  // Initialised from storage rather than a constant, so the first React render
  // already agrees with what the pre-paint script in index.html applied. Starting
  // at a default and correcting in an effect would flash the wrong theme.
  const [preference, setPreference] = useState(readStoredPreference);
  const [resolved, setResolved] = useState(() => resolve(readStoredPreference()));

  const choose = useCallback((next) => {
    if (!THEME_PREFERENCES.includes(next)) return;

    setPreference(next);
    const nextResolved = resolve(next);
    setResolved(nextResolved);
    applyTheme(nextResolved);

    // Animate the colour change, but only for a deliberate toggle — see the
    // .theme-transition rule. Removed afterwards so navigation and data updates
    // are not dragged through a transition too.
    const root = document.documentElement;
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 200);

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply will not persist; the session still honours it.
    }
  }, []);

  // While on 'system', track the OS changing underneath us — someone whose
  // machine flips to dark at sunset should see the app follow without a reload.
  useEffect(() => {
    if (preference !== 'system') return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');

    const onChange = (event) => {
      const next = event.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference: choose }),
    [preference, resolved, choose]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
