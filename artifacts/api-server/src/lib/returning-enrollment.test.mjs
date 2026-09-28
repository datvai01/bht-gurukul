import assert from "node:assert/strict";
import { test } from "node:test";
import { returningEnrollmentConflictMessage } from "./returning-enrollment.ts";

test("new course levels can be enrolled without a conflict", () => {
  assert.equal(returningEnrollmentConflictMessage([]), null);
});

test("existing and completed course levels return an actionable conflict", () => {
  for (const status of ["Enrolled", "Completed"]) {
    assert.match(returningEnrollmentConflictMessage([status]), /already has an enrollment/);
  }
});

test("withdrawn course levels require reactivation rather than another insert", () => {
  assert.match(returningEnrollmentConflictMessage(["Withdrawn"]), /reactivate/);
  assert.match(returningEnrollmentConflictMessage(["Withdrawn", "Enrolled"]), /already has an enrollment/);
});