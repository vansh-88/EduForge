import { useEffect, useState } from 'react';

/**
 * Trails `value` by `delay` ms.
 *
 * Used to keep a search box responsive while the request it drives fires once
 * the reader stops typing, rather than once per keystroke.
 */
export const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};
