// Keeps every screen live. Realtime is the fast path, but a phone that sleeps, changes network or
// keeps a tab in the background loses the socket without telling anyone. So:
// - when the app comes back (visible, focus, online) or the socket comes back, the connection is
//   healed (fresh token, reconnect) and every screen is told to load again ("wake");
// - each screen also checks by itself every few seconds while it is on screen;
// - a channel that errors or closes is thrown away and made again.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { createGate, isDeadChannel } from './liveSyncCore';

export { createGate, isDeadChannel };

type Listener = () => void;

const isWeb = Platform.OS === 'web' && typeof document !== 'undefined' && typeof window !== 'undefined';
export const isOnScreen = (): boolean => !isWeb || !document.hidden;

const listeners = new Set<Listener>();
const gate = createGate(1500);
let started = false;
let socketWasDown = false;

const heal = async () => {
  try {
    // getSession refreshes an expired token; the socket must carry the fresh one or the server drops it
    await supabase.auth.getSession();
    await supabase.realtime.setAuth();
    if (!supabase.realtime.isConnected()) supabase.realtime.connect();
  } catch {
    // Offline: the next wake tries again
  }
};

export const wake = () => {
  if (!gate()) return;
  heal().finally(() => {
    listeners.forEach((cb) => {
      try {
        cb();
      } catch {
        // One screen failing must not stop the others
      }
    });
  });
};

export const startLiveSync = () => {
  if (started) return;
  started = true;
  if (isWeb) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) wake();
    });
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
  }
  // Whatever changed while the socket was down never arrives: load it when the socket is back
  supabase.realtime.onHeartbeat((status) => {
    if (status === 'timeout' || status === 'error' || status === 'disconnected') socketWasDown = true;
    else if (status === 'ok' && socketWasDown) {
      socketWasDown = false;
      wake();
    }
  });
};

export const onWake = (cb: Listener): (() => void) => {
  startLiveSync();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export interface LiveTable {
  table: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  filter?: string;
}

let channelCount = 0;

/**
 * Subscribes to database changes and makes the channel again whenever it dies.
 * `onChange` gets each payload; returns the function that stops it.
 */
export const liveChannel = (name: string, tables: LiveTable[], onChange: (payload: any) => void): (() => void) => {
  let stopped = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    // A fixed topic would hand back the old, still-closing channel, where .on() throws
    channelCount += 1;
    let next = supabase.channel(`${name}-${Date.now()}-${channelCount}`);
    tables.forEach((t) => {
      next = next.on(
        'postgres_changes' as any,
        { event: t.event ?? '*', schema: 'public', table: t.table, ...(t.filter ? { filter: t.filter } : {}) },
        (payload: any) => {
          if (!stopped) onChange(payload);
        }
      );
    });
    channel = next;
    next.subscribe((status: string) => {
      if (stopped || channel !== next || !isDeadChannel(status)) return;
      channel = null;
      supabase.removeChannel(next);
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => {
        retry = null;
        open();
        // Changes made while it was dead are gone: let the screen load again
        onChange(null);
      }, 2000);
    });
  };

  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (channel) supabase.removeChannel(channel);
    channel = null;
  };
};

/**
 * Keeps a screen's data fresh: loads again on database changes (if `tables` is given), when the
 * app wakes, and every `every` ms while the screen is visible. The first load stays with the screen.
 */
export const useLiveRefresh = (
  load: () => unknown,
  opts: { name: string; every?: number; tables?: LiveTable[]; enabled?: boolean; deps?: unknown[] }
) => {
  const loadRef = useRef(load);
  loadRef.current = load;
  const { name, every, tables, enabled = true, deps = [] } = opts;
  const tablesKey = JSON.stringify(tables ?? []);

  useEffect(() => {
    if (!enabled) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    // A burst of changes (a round saves several rows) loads once
    const soon = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        loadRef.current();
      }, 300);
    };
    const stopWake = onWake(soon);
    const timer = every
      ? setInterval(() => {
          if (isOnScreen()) loadRef.current();
        }, every)
      : null;
    const parsed: LiveTable[] = JSON.parse(tablesKey);
    const stopChannel = parsed.length > 0 ? liveChannel(name, parsed, soon) : null;
    return () => {
      stopWake();
      if (timer) clearInterval(timer);
      if (pending) clearTimeout(pending);
      if (stopChannel) stopChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, every, name, tablesKey, ...deps]);
};
