import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveParentDetails } from "./primary-member.ts";

const mother = { name: "Manual mother", phone: "1111111111", email: "mother@test.invalid", employer: "M" };
const father = { name: "Manual father", phone: "2222222222", email: "father@test.invalid", employer: "F" };

test("choosing Mother fills only the mother from the member", () => {
  const result = resolveParentDetails("mother", { name: "Member", phone: "3333333333", email: "member@test.invalid", employer: "Temple" }, mother, father);
  assert.deepEqual(result.mother, { name: "Member", phone: "3333333333", email: "member@test.invalid", employer: "Temple" });
  assert.deepEqual(result.father, father);
});

test("switching to Father or changing the member refreshes the selected parent", () => {
  const first = resolveParentDetails("father", { name: "First member", phone: "3333333333", email: null }, mother, father);
  const second = resolveParentDetails("father", { name: "New member", phone: "4444444444", email: null }, mother, father);
  assert.deepEqual(first.mother, mother);
  assert.equal(first.father.email, father.email);
  assert.equal(second.father.name, "New member");
  assert.equal(second.father.phone, "4444444444");
});

test("no role leaves both parents manually editable", () => {
  assert.deepEqual(resolveParentDetails(null, { name: "Member", phone: null, email: null }, mother, father), { mother, father });
});