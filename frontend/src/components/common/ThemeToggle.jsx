import { useTheme } from '../../hooks/useTheme';

const SunIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

const SystemIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

// Cycles in a predictable order. `system` sits last so the two explicit choices
// are one press apart and the escape hatch back to "follow my OS" is always
// reachable without a menu.
const ORDER = ['light', 'dark', 'system'];

const META = {
  light: { Icon: SunIcon, label: 'Light' },
  dark: { Icon: MoonIcon, label: 'Dark' },
  system: { Icon: SystemIcon, label: 'System' },
};

/**
 * Cycles light → dark → system.
 *
 * The icon shows the *preference*, not the resolved theme, so 'system' is
 * visibly its own state rather than masquerading as whichever one the OS
 * happens to be on — otherwise a user cannot tell whether they are pinned or
 * following, and pressing the button seems to do nothing on the third press.
 */
export const ThemeToggle = ({ className = '', showLabel = false }) => {
  const { preference, resolved, setPreference } = useTheme();

  const { Icon, label } = META[preference] ?? META.system;
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

  const description =
    preference === 'system' ? `System (currently ${resolved})` : label;

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      title={`Theme: ${description}. Click for ${META[next].label.toLowerCase()}.`}
      aria-label={`Theme: ${description}. Switch to ${META[next].label.toLowerCase()}.`}
      className={`inline-flex items-center gap-2 rounded-md p-2 text-muted transition hover:bg-subtle hover:text-ink focus:outline-none focus:ring-2 focus:ring-primary ${className}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {showLabel && <span className="text-sm">{description}</span>}
    </button>
  );
};
