/** Pure VIP rules, shared by the app and the unit tests. */

export const isVipActive = (info: { vip_until?: string | null } | null | undefined, now = Date.now()): boolean =>
  !!info?.vip_until && new Date(info.vip_until).getTime() > now;

/** Whole days left, rounded up: 1 hour left still reads "1 día". */
export const vipDaysLeft = (vipUntil: string | null | undefined, now = Date.now()): number =>
  vipUntil ? Math.max(0, Math.ceil((new Date(vipUntil).getTime() - now) / 86_400_000)) : 0;
