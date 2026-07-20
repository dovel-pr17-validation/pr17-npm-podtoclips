import { useEffect, useState } from 'react';

export type ProductTheme = 'light' | 'dark';

const readTheme = (): ProductTheme => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('easyedits-product-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const useProductTheme = () => {
  const [theme, setTheme] = useState<ProductTheme>(readTheme);

  useEffect(() => {
    window.localStorage.setItem('easyedits-product-theme', theme);
    document.documentElement.dataset.productTheme = theme;
    window.dispatchEvent(new CustomEvent('easyedits-theme-change', { detail: theme }));
  }, [theme]);

  useEffect(() => {
    const syncTheme = (event: Event) => {
      const nextTheme = (event as CustomEvent<ProductTheme>).detail;
      if (nextTheme === 'light' || nextTheme === 'dark') setTheme(nextTheme);
    };
    window.addEventListener('easyedits-theme-change', syncTheme);
    return () => window.removeEventListener('easyedits-theme-change', syncTheme);
  }, []);

  return { theme, setTheme, toggleTheme: () => setTheme((current) => current === 'light' ? 'dark' : 'light') };
};
