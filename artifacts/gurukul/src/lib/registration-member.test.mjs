import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureRegistrationMember } from "./registration-member.ts";

test("retry after student registration failure reuses the already-created member", async () => {
  const details = { firstName: "Parent", lastName: "One", name: "Parent One", email: "parent@example.test", phone: "1234567890", address: "1 Test St, City, OH 12345" };
  let saved = null;
  let createCalls = 0;
  const ensure = () => ensureRegistrationMember(
    saved,
    details,
    async () => { createCalls++; return { id: 42 }; },
    member => { saved = member; },
  );
  const firstId = await ensure();
  await assert.rejects(Promise.reject(new Error("student ID collision")), /student ID collision/);
  const retryId = await ensure();
  assert.equal(firstId, 42);
  assert.equal(retryId, 42);
  assert.equal(createCalls, 1);
});

test("does not silently link a saved member after contact or address details change", async () => {
  const saved = { id: 42, firstName: "Parent", lastName: "One", name: "Parent One", email: "parent@example.test", phone: "1234567890", address: "1 Test St, City, OH 12345" };
  for (const changed of [{ ...saved, phone: "9876543210" }, { ...saved, address: "2 Test St, City, OH 12345" }]) {
    await assert.rejects(
      ensureRegistrationMember(saved, changed, async () => { throw new Error("Unexpected create"); }, () => {}),
      /record was saved/,
    );
  }
});

test("remembers the issued member context and employer for a safe retry", async () => {
  const details = { firstName: "Parent", lastName: "One", name: "Parent One", email: "parent@example.test", phone: "1234567890", address: "1 Test St, City, OH 12345", employer: "Temple" };
  let saved = null;
  const id = await ensureRegistrationMember(null, details,
    async () => ({ id: 42, memberCode: "MEM-2026-0042", memberContextToken: "signed-context" }),
    member => { saved = member; },
  );
  assert.equal(id, 42);
  assert.equal(saved.memberContextToken, "signed-context");
  assert.equal(saved.memberCode, "MEM-2026-0042");
  await assert.rejects(
    ensureRegistrationMember(saved, { ...details, employer: "Another employer" }, async () => { throw new Error("Unexpected create"); }, () => {}),
    /details have changed/,
  );
});
test("a retry is not treated as edited when the created row normalizes blank fields", async () => {
  const details = { firstName: "Parent", lastName: "One", name: "Parent One", email: "parent@example.test", phone: "1234567890", address: "1 Test St, City, OH 12345", employer: "" };
  let saved = null;
  let createCalls = 0;
  const create = async () => { createCalls++; return { id: 42, memberCode: "MEM-2026-0042", memberContextToken: "t", employer: null, email: "PARENT@example.test" }; };
  await ensureRegistrationMember(null, details, create, member => { saved = member; });
  assert.equal(await ensureRegistrationMember(saved, details, create, () => {}), 42);
  assert.equal(createCalls, 1);
});
