import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface ActionLock {
  /** Key of the action running right now, or null when nothing is running. */
  active: string | null;
  /** True while any action holds the lock. */
  busy: boolean;
  /** True for every action except the one currently holding the lock. */
  blocked: (key: string) => boolean;
  /**
   * Run `fn` under the lock. A call made while another action holds it is
   * dropped, so a second click cannot start a second action.
   */
  run: <T>(key: string, fn: () => Promise<T> | T) => Promise<T | undefined>;
  /** Hold the lock for a fixed time — for a link the browser handles itself. */
  hold: (key: string, ms?: number) => void;
}

const IDLE: ActionLock = {
  active: null,
  busy: false,
  blocked: () => false,
  run: async (_k, fn) => fn(),
  hold: () => {},
};

const Ctx = createContext<ActionLock>(IDLE);

/**
 * One lock per Evidence Vault: while a row is opening, uploading, sending or
 * reminding, every other row's actions disable themselves (CS-567). Without it
 * each row kept its own busy flag, so a second click during the first action
 * started a second one — two documents opening at once.
 */
export function ActionLockProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  // The state update is async; the ref makes a double click in the same tick safe.
  const held = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  const release = useCallback(() => {
    held.current = null;
    setActive(null);
  }, []);

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T> | T): Promise<T | undefined> => {
    if (held.current) return undefined;
    held.current = key;
    setActive(key);
    try {
      return await fn();
    } finally {
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
      release();
    }
  }, [release]);

  const hold = useCallback((key: string, ms = 1200) => {
    if (held.current) return;
    held.current = key;
    setActive(key);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(release, ms);
  }, [release]);

  const value = useMemo<ActionLock>(() => ({
    active,
    busy: active !== null,
    blocked: (key: string) => active !== null && active !== key,
    run,
    hold,
  }), [active, run, hold]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The vault's lock. Outside a provider it reports idle and runs inline. */
export function useActionLock(): ActionLock {
  return useContext(Ctx);
}
