'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});

/** A short confirmation at the bottom of the screen. It is announced politely and goes away by itself. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    window.clearTimeout(timer.current);
    setToast(message);
    timer.current = window.setTimeout(() => setToast(''), 4200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </ToastContext.Provider>
  );
}

/** `const showToast = useToast(); showToast('Saved.');` */
export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}
