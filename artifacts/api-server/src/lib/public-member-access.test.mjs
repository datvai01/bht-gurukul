import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  clearPublicMemberAccessCookie,
  getVerifiedPublicIdentity,
  getVerifiedPublicPhone,
  setPublicMemberAccessCookie,
} from "./public-member-access.ts";

const secret = "public-member-access-test-key";

function responseMock() {
  const cookies = [];
  return {
    cookies,
    append(_name, value) {
      cookies.push(value);
    },
  };
}

test("v3 access cookie binds normalized phone, email, and flow mode", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  try {
    const res = responseMock();
    setPublicMemberAccessCookie(res, "6145550100", "member@example.com", "existing");
    const req = { headers: { cookie: res.cookies.at(-1).split(";")[0] } };
    assert.equal(getVerifiedPublicPhone(req), "6145550100");
    assert.deepEqual(getVerifiedPublicIdentity(req), {
      phone: "6145550100",
      email: "member@example.com",
      mode: "existing",
    });

    const tampered = { headers: { cookie: `${req.headers.cookie}x` } };
    assert.equal(getVerifiedPublicPhone(tampered), null);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("legacy phone-only access proofs are rejected by the v3 signature", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  try {
    const payload = Buffer.from(JSON.stringify({
      phone: "6145550100",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    })).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update("gurukul-public-phone-access-v2")
      .update(payload)
      .digest("base64url");
    assert.equal(
      getVerifiedPublicPhone({ headers: { cookie: `public_member_access=${payload}.${signature}` } }),
      null,
    );
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("access proof rejects invalid identity claims and supports new-member mode", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  try {
    const res = responseMock();
    setPublicMemberAccessCookie(res, "6145550100", "new@example.com", "new");
    const req = { headers: { cookie: res.cookies.at(-1).split(";")[0] } };
    assert.deepEqual(getVerifiedPublicIdentity(req), {
      phone: "6145550100",
      email: "new@example.com",
      mode: "new",
    });
    const [cookieName, value] = req.headers.cookie.split("=");
    const [encoded, signature] = value.split(".");
    const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    claims.email = "invalid";
    const badPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const badSignature = createHmac("sha256", secret)
      .update("gurukul-public-member-access-v3")
      .update(badPayload)
      .digest("base64url");
    assert.equal(getVerifiedPublicIdentity({
      headers: { cookie: `${cookieName}=${badPayload}.${badSignature}` },
    }), null);
    assert.ok(signature);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("new-member access proof can be bound to a single created member ID", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  try {
    const res = responseMock();
    setPublicMemberAccessCookie(res, "6145550100", "new@example.com", "new", 37);
    const req = { headers: { cookie: res.cookies.at(-1).split(";")[0] } };
    assert.deepEqual(getVerifiedPublicIdentity(req), {
      phone: "6145550100",
      email: "new@example.com",
      mode: "new",
      memberId: 37,
    });
    const existingRes = responseMock();
    setPublicMemberAccessCookie(existingRes, "6145550100", "existing@example.com", "existing", 37);
    assert.deepEqual(getVerifiedPublicIdentity({
      headers: { cookie: existingRes.cookies.at(-1).split(";")[0] },
    }), {
      phone: "6145550100",
      email: "existing@example.com",
      mode: "existing",
      memberId: 37,
    });
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("clearing phone proof applies the required cookie protections", () => {
  const res = responseMock();
  clearPublicMemberAccessCookie(res);
  assert.match(res.cookies[0], /^public_member_access=;/);
  assert.match(res.cookies[0], /Path=\/api/);
  assert.match(res.cookies[0], /HttpOnly/);
  assert.match(res.cookies[0], /SameSite=Strict/);
  assert.match(res.cookies[0], /Max-Age=0/);
});