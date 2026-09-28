import assert from "node:assert/strict";
import { test } from "node:test";
import { membershipExpiry as serverExpiry, membershipStatus as serverStatus, templeYear as serverYear } from "./membership.ts";
import { membershipExpiry as clientExpiry, membershipExpiryLabel, membershipStatus as clientStatus, templeYear as clientYear } from "../../../gurukul/src/lib/membership.ts";

const date = (iso) => new Date(iso);
const membership = (start, now) => {
  const registeredAt = date(start);
  const checkedAt = date(now);
  const server = serverStatus(registeredAt, checkedAt);
  const client = clientStatus(start, checkedAt);
  assert.deepEqual(client, server, "Member list, registration, and server must agree");
  return server;
};

test("January, June, and November registrations all expire December 31", () => {
  for (const start of ["2026-01-15T15:00:00Z", "2026-06-10T15:00:00Z", "2026-11-25T15:00:00Z"]) {
    assert.equal(serverYear(date(start)), 2026);
    assert.equal(clientYear(date(start)), 2026);
    assert.equal(serverExpiry(date(start)).toISOString(), "2027-01-01T05:00:00.000Z");
    assert.equal(clientExpiry(date(start)).toISOString(), "2027-01-01T05:00:00.000Z");
    assert.equal(membershipExpiryLabel(start), "December 31, 2026");
    assert.equal(membership(start, "2026-12-31T23:59:59-05:00").isActive, true);
    assert.deepEqual(membership(start, "2027-01-01T00:00:00-05:00"), { isActive: false, expiringSoon: false });
  }
});

test("renewal in the next year reactivates through that December; same-year renewal cannot extend it", () => {
  assert.equal(membership("2026-12-15T12:00:00-05:00", "2027-01-01T00:00:00-05:00").isActive, false);
  assert.equal(membership("2027-01-01T00:01:00-05:00", "2027-06-01T12:00:00-04:00").isActive, true);
  assert.equal(membershipExpiryLabel("2027-01-01T00:01:00-05:00"), "December 31, 2027");
  assert.equal(membership("2027-12-20T12:00:00-05:00", "2028-01-01T00:00:00-05:00").isActive, false);
});

test("Expiring Soon starts exactly 30 days before January 1 in Eastern time", () => {
  const start = "2026-11-25T15:00:00Z";
  assert.deepEqual(membership(start, "2026-12-01T23:59:59-05:00"), { isActive: true, expiringSoon: false });
  assert.deepEqual(membership(start, "2026-12-02T00:00:00-05:00"), { isActive: true, expiringSoon: true });
  assert.deepEqual(membership("2026-12-20T12:00:00-05:00", "2026-12-20T12:00:00-05:00"), { isActive: true, expiringSoon: true });
});

test("Eastern New Year boundary is consistent even when the browser or server runs in another time zone", () => {
  assert.equal(membership("2025-12-31T23:59:00-05:00", "2026-01-01T00:00:00-05:00").isActive, false);
  assert.equal(membership("2026-01-01T00:00:00-05:00", "2026-01-01T00:00:01-05:00").isActive, true);
  assert.equal(serverYear(date("2027-01-01T04:59:59Z")), 2026);
  assert.equal(clientYear(date("2027-01-01T05:00:00Z")), 2027);
  assert.equal(membership(null, "2026-12-31T12:00:00-05:00").isActive, false);
});