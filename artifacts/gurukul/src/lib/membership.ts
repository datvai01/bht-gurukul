// Temple membership validity follows the temple's calendar year, not the visitor's time zone.
const templeYearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
});

export function templeYear(date: Date = new Date()): number {
  return Number(templeYearFormatter.format(date));
}

export function membershipExpiry(start: Date): Date {
  // January 1 at midnight in New York is always 05:00 UTC (EST).
  return new Date(Date.UTC(templeYear(start) + 1, 0, 1, 5));
}

export function membershipStatus(start: Date | string | null, now: Date = new Date()) {
  const date = start instanceof Date ? start : start ? new Date(start) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    return { isActive: false, expiringSoon: false };
  }
  const isActive = date <= now && templeYear(date) === templeYear(now);
  return {
    isActive,
    expiringSoon: isActive && membershipExpiry(date).getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000,
  };
}

export function membershipExpiryLabel(start: Date | string): string {
  const date = start instanceof Date ? start : new Date(start);
  return `December 31, ${templeYear(date)}`;
}