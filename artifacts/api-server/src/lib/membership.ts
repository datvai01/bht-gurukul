// Temple memberships are calendar-year terms in the temple's Eastern time zone.
// createdAt is the effective start: the renewal endpoint resets it to the renewal time.
const templeYearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
});

export function templeYear(date: Date = new Date()): number {
  return Number(templeYearFormatter.format(date));
}

export function templeDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function membershipExpiry(start: Date): Date {
  // January 1 at midnight in New York is always 05:00 UTC (EST).
  return new Date(Date.UTC(templeYear(start) + 1, 0, 1, 5));
}

export function membershipStatus(start: Date | null, now: Date = new Date()) {
  if (!start || !Number.isFinite(start.getTime())) {
    return { isActive: false, expiringSoon: false };
  }
  const isActive = start <= now && templeYear(start) === templeYear(now);
  return {
    isActive,
    expiringSoon: isActive && membershipExpiry(start).getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000,
  };
}