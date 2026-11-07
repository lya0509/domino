// Pure pieces of liveSync, kept apart so they can be tested without React or Supabase.

/** Waking twice in a row (focus + visibilitychange fire together) loads only once. */
export const createGate = (minGapMs: number, now: () => number = Date.now) => {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minGapMs) return false;
    last = t;
    return true;
  };
};

/** Channel states after which no change will ever arrive on that channel. */
export const isDeadChannel = (status: string): boolean =>
  status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
