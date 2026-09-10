import { useContext } from 'react';
import { ThemeContext } from '../theme/themeContext';

/**
 * The current theme: `{ preference, resolved, setPreference }`.
 *
 * `preference` is what the user picked ('light' | 'dark' | 'system').
 * `resolved` is what is actually on screen ('light' | 'dark') — use this to
 * decide which icon to show, never `preference`, or a 'system' user in dark mode
 * sees a sun.
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }

  return context;
};
