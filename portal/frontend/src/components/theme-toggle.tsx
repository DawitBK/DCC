'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'dcc.theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    const currentTheme: Theme = storedTheme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = currentTheme;
    setTheme(currentTheme);

    const synchronizeTheme = () => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    };
    window.addEventListener('dcc-theme-change', synchronizeTheme);
    return () => window.removeEventListener('dcc-theme-change', synchronizeTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event('dcc-theme-change'));
    setTheme(nextTheme);
  };

  return (
    <button
      type="button"
      className={`icon-button theme-toggle ${className}`.trim()}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={theme === 'dark'}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}
