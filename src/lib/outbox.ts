export interface OutboxItem {
  id: string;
  payload: unknown;
}

/**
 * Keeps everything except what the server confirmed. An item edited while it was being sent
 * has a new payload, so it stays for the next flush; anything queued meanwhile stays too.
 */
export const removeConfirmedItems = <T extends OutboxItem>(
  queue: T[],
  confirmed: Map<string, unknown>
): T[] => queue.filter((item) => !confirmed.has(item.id) || confirmed.get(item.id) !== item.payload);

/** Hands are sent whole, so anything sent ahead of a queued item would be overwritten by it. */
export const hasQueuedGame = (queue: OutboxItem[], gameId: string): boolean =>
  queue.some((item) => {
    const payload = item.payload as { p_id?: string; p_game?: string } | null;
    return payload?.p_id === gameId || payload?.p_game === gameId;
  });
