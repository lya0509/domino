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
