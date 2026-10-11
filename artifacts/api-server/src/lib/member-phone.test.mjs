import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMemberPhone } from "./member-phone.ts";

test("member phones accept US numbers and India numbers entered with +91", () => {
  assert.equal(normalizeMemberPhone("(614) 555-0199"), "6145550199");
  assert.equal(normalizeMemberPhone("+1-6145550199"), "6145550199");
  assert.equal(normalizeMemberPhone("+91 98765 43210"), "919876543210");
  assert.equal(normalizeMemberPhone("919876543210"), "919876543210");
  // A bare ten-digit number is always a US number.
  assert.equal(normalizeMemberPhone("9876543210"), "9876543210");
});

test("invalid and other-country numbers are rejected", () => {
  assert.equal(normalizeMemberPhone("+91 12345 67890"), null);
  assert.equal(normalizeMemberPhone("+44 7700 900123"), null);
  assert.equal(normalizeMemberPhone("1111111111"), null);
  assert.equal(normalizeMemberPhone("555"), null);
});
