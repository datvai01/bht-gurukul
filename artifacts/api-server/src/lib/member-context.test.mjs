import assert from "node:assert/strict";
import test from "node:test";
import {
  createLookupMemberContextToken,
  createMemberContextToken,
  createNewMemberContextToken,
  MEMBER_CONTEXT_TOKEN_TTL_SECONDS,
  NEW_MEMBER_CONTEXT_TOKEN_TTL_SECONDS,
  VERIFIED_MEMBER_CONTEXT_TOKEN_TTL_SECONDS,
  resolvePrimaryParentContacts,
  verifyMemberContextToken,
  verifyNewMemberContextToken,
  createVerifiedMemberContextToken,
  verifyVerifiedMemberContextToken,
} from "./member-context.ts";

const secret = "member-context-test-key";

test("member context tokens are bound to their member and reject tampering", () => {
  const now = 1_700_000_000_000;
  const token = createMemberContextToken(42, secret, now);

  assert.equal(verifyMemberContextToken(token, 42, secret, now), true);
  assert.equal(verifyMemberContextToken(token, 43, secret, now), false);
  assert.equal(verifyMemberContextToken(`${token}x`, 42, secret, now), false);
  assert.equal(verifyMemberContextToken(token, 42, "different-key", now), false);
});

test("member context tokens expire after their short-lived validity window", () => {
  const now = 1_700_000_000_000;
  const token = createMemberContextToken(42, secret, now);

  assert.equal(
    verifyMemberContextToken(token, 42, secret, now + MEMBER_CONTEXT_TOKEN_TTL_SECONDS * 1000),
    false,
  );
});

test("lookup-purpose tokens cannot authorize existing-member registration", () => {
  const now = 1_700_000_000_000;
  const lookupToken = createLookupMemberContextToken(42, secret, now);

  assert.equal(verifyMemberContextToken(lookupToken, 42, secret, now), false);
  assert.equal(verifyNewMemberContextToken(lookupToken, 42, secret, now), false);
  assert.equal(verifyVerifiedMemberContextToken(lookupToken, 42, secret, now), false);
});

test("verified-member-purpose tokens are accepted only by their matching validator", () => {
  const now = 1_700_000_000_000;
  const token = createVerifiedMemberContextToken(42, secret, now);

  assert.equal(verifyVerifiedMemberContextToken(token, 42, secret, now), true);
  assert.equal(verifyVerifiedMemberContextToken(token, 43, secret, now), false);
  assert.equal(verifyVerifiedMemberContextToken(token, 42, "different-key", now), false);
  assert.equal(verifyMemberContextToken(token, 42, secret, now), false);
  assert.equal(verifyNewMemberContextToken(token, 42, secret, now), false);
  assert.equal(verifyVerifiedMemberContextToken(
    token,
    42,
    secret,
    now + VERIFIED_MEMBER_CONTEXT_TOKEN_TTL_SECONDS * 1000,
  ), false);
});

test("new-member token is purpose-bound and expires within the shorter creation window", () => {
  const now = 1_700_000_000_000;
  const token = createNewMemberContextToken(42, secret, now);

  assert.equal(verifyNewMemberContextToken(token, 42, secret, now), true);
  assert.equal(verifyNewMemberContextToken(token, 43, secret, now), false);
  assert.equal(verifyNewMemberContextToken(token, 42, "different-key", now), false);
  assert.equal(verifyNewMemberContextToken(
    token,
    42,
    secret,
    now + NEW_MEMBER_CONTEXT_TOKEN_TTL_SECONDS * 1000,
  ), false);
  assert.equal(verifyMemberContextToken(token, 42, secret, now), false);
});

test("primary parent keeps the parent's edited details from the registration form", () => {
  const result = resolvePrimaryParentContacts("mother", {
    motherName: "  Morgan M. Member ",
    motherPhone: "(614) 555-0101",
    motherEmail: "Morgan.New@example.org",
    motherEmployer: "Submitted employer",
    fatherName: "Other parent",
  }, {
    name: "Morgan Member",
    phone: "614-555-0100",
    email: "morgan@example.org",
    employer: "Canonical employer",
  });

  assert.deepEqual(result, {
    ok: true,
    fields: {
      motherName: "Morgan M. Member",
      motherPhone: "6145550101",
      motherEmail: "morgan.new@example.org",
      motherEmployer: "Submitted employer",
    },
  });
});

test("blank primary fields fall back to the member record; missing member details are allowed", () => {
  assert.deepEqual(
    resolvePrimaryParentContacts("father", {}, {
      name: "Member Name", phone: "(614) 555-0100", email: "member@example.org", employer: "Temple",
    }),
    {
      ok: true,
      fields: {
        fatherName: "Member Name",
        fatherPhone: "(614) 555-0100",
        fatherEmail: "member@example.org",
        fatherEmployer: "Temple",
      },
    },
  );
  assert.deepEqual(
    resolvePrimaryParentContacts("father", { fatherName: "Manual parent" }, {}),
    {
      ok: true,
      fields: {
        fatherName: "Manual parent",
        fatherPhone: null,
        fatherEmail: null,
        fatherEmployer: null,
      },
    },
  );
});

test("edited primary phone and email must be valid", () => {
  assert.deepEqual(
    resolvePrimaryParentContacts("mother", { motherPhone: "1111111111" }, { phone: "614-555-0100" }),
    { ok: false, field: "phone" },
  );
  assert.deepEqual(
    resolvePrimaryParentContacts("mother", { motherEmail: "not-an-email" }, { email: "member@example.org" }),
    { ok: false, field: "email" },
  );
  assert.equal(
    resolvePrimaryParentContacts("mother", { motherPhone: "+91 98765 43210" }, {}).ok,
    true,
  );
});