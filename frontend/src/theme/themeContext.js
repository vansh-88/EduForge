import { createContext } from 'react';

export const STORAGE_KEY = 'eduforge.theme';

/** What the user chose. 'system' defers to the OS rather than pinning a value. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'];

// Split out from ThemeProvider so that file exports only a component — React Fast
// Refresh cannot preserve state across edits to a module that also exports
// non-components, which would make every edit to the provider reset the theme.
export const ThemeContext = createContext(null);
