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

// A membership ends on December 31 of its start year, or of a later year the
// member has already paid for in advance (members.membership_year).
export function membershipEndYear(start: Date, paidThroughYear?: number | null): number {
  return Math.max(templeYear(start), paidThroughYear ?? 0);
}

export function membershipExpiry(start: Date, paidThroughYear?: number | null): Date {
  // January 1 at midnight in New York is always 05:00 UTC (EST).
  return new Date(Date.UTC(membershipEndYear(start, paidThroughYear) + 1, 0, 1, 5));
}

export function membershipStatus(start: Date | null, now: Date = new Date(), paidThroughYear?: number | null) {
  if (!start || !Number.isFinite(start.getTime())) {
    return { isActive: false, expiringSoon: false };
  }
  const isActive = start <= now && membershipEndYear(start, paidThroughYear) >= templeYear(now);
  return {
    isActive,
    expiringSoon: isActive && membershipExpiry(start, paidThroughYear).getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000,
  };
}