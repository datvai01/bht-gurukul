/** Required US address format used for new and confirmed member/student addresses. */
const US_STATE_AND_TERRITORY_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
]);

export function isValidUsStateCode(value: string): boolean {
  return US_STATE_AND_TERRITORY_CODES.has(value.toUpperCase());
}

export function isCompleteAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.trim().match(/^(.+),\s*(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!match) return false;
  const [, street, city, state] = match;
  return street.trim().length >= 5
    && /\d/.test(street)
    && city.trim().length >= 2
    && isValidUsStateCode(state);
}