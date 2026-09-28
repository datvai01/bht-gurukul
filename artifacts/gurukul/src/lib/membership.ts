// Temple membership validity follows the temple's calendar year, not the visitor's time zone.
const templeYearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
});

export function templeYear(date: Date = new Date()): number {
  return Number(templeYearFormatter.format(date));
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

export function membershipStatus(start: Date | string | null, now: Date = new Date(), paidThroughYear?: number | null) {
  const date = start instanceof Date ? start : start ? new Date(start) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    return { isActive: false, expiringSoon: false };
  }
  const isActive = date <= now && membershipEndYear(date, paidThroughYear) >= templeYear(now);
  return {
    isActive,
    expiringSoon: isActive && membershipExpiry(date, paidThroughYear).getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000,
  };
}

export function membershipExpiryLabel(start: Date | string, paidThroughYear?: number | null): string {
  const date = start instanceof Date ? start : new Date(start);
  return `December 31, ${membershipEndYear(date, paidThroughYear)}`;
}