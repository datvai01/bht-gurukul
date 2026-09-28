import assert from "node:assert/strict";
import test from "node:test";
import {
  hashMemberOtpSession,
  matchesMemberOtpSession,
} from "./member-otp-session.ts";

const secret = "member-otp-session-test-key";
const phoneHash = "phone-hmac-key";
const validToken = Buffer.alloc(32, 7).toString("base64url");

function requestWithCookie(token) {
  return {
    headers: {
      cookie: token ? `member_otp_session=${token}; other=value` : undefined,
    },
  };
}

test("OTP session proof accepts only the matching browser cookie", () => {
  const expectedHash = hashMemberOtpSession(phoneHash, validToken, secret);
  assert.equal(matchesMemberOtpSession(
    requestWithCookie(validToken),
    phoneHash,
    expectedHash,
    secret,
  ), true);
  assert.equal(matchesMemberOtpSession(
    requestWithCookie(Buffer.alloc(32, 8).toString("base64url")),
    phoneHash,
    expectedHash,
    secret,
  ), false);
  assert.equal(matchesMemberOtpSession(
    requestWithCookie(null),
    phoneHash,
    expectedHash,
    secret,
  ), false);
});

test("OTP session proof is bound to the phone challenge and signing secret", () => {
  const expectedHash = hashMemberOtpSession(phoneHash, validToken, secret);
  assert.equal(matchesMemberOtpSession(
    requestWithCookie(validToken),
    "different-phone-hash",
    expectedHash,
    secret,
  ), false);
  assert.equal(matchesMemberOtpSession(
    requestWithCookie(validToken),
    phoneHash,
    expectedHash,
    "different-secret",
  ), false);
});