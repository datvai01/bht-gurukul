import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateStudentCode, formatStudentCode } from "./student-code.ts";
import { pgErrorInfo } from "./pg-error.ts";

test("chooses the next highest student code, not the code on the newest row", async () => {
  const rowsById = ["GK-047", "GK-019", "GK-036"];
  let saved;
  const result = await allocateStudentCode(
    undefined,
    async () => {},
    async () => Math.max(...rowsById.map(code => Number(code.slice(3)))),
    async code => { saved = code; return code; },
  );
  assert.equal(rowsById.at(-1), "GK-036");
  assert.equal(result, "GK-048");
  assert.equal(saved, "GK-048");
  assert.equal(formatStudentCode(1), "GK-001");
});

test("serializes simultaneous allocations before either reads the maximum", async () => {
  const codes = ["GK-047"];
  let lastTransaction = Promise.resolve();
  const transaction = async () => {
    const before = lastTransaction;
    let release;
    lastTransaction = new Promise(resolve => { release = resolve; });
    try {
      return await allocateStudentCode(
        undefined,
        async () => { await before; },
        async () => Math.max(...codes.map(code => Number(code.slice(3)))),
        async code => {
          await new Promise(resolve => setTimeout(resolve, 1));
          assert.equal(codes.includes(code), false);
          codes.push(code);
          return code;
        },
      );
    } finally {
      release();
    }
  };
  const assigned = await Promise.all([transaction(), transaction(), transaction()]);
  assert.deepEqual(assigned, ["GK-048", "GK-049", "GK-050"]);
  assert.equal(new Set(codes).size, codes.length);
});

test("manual IDs remain explicit and duplicate constraints survive Drizzle's error wrapper", async () => {
  const code = await allocateStudentCode(
    "SPECIAL-1",
    async () => {},
    async () => { throw new Error("Should not read maximum for an explicit ID"); },
    async assigned => assigned,
  );
  assert.equal(code, "SPECIAL-1");
  assert.deepEqual(
    pgErrorInfo({ cause: { code: "23505", constraint: "students_student_code_unique" } }),
    { code: "23505", constraint: "students_student_code_unique" },
  );
  assert.equal(pgErrorInfo(new Error("other failure")), null);
});