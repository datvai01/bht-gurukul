import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import { isCompleteAddress } from "./address.ts";

test("legacy street-only addresses cannot be confirmed as complete", () => {
  assert.equal(isCompleteAddress("123 Main Street"), false);
  assert.equal(isCompleteAddress("123 Main St, Powell, OH"), false);
  assert.equal(isCompleteAddress("123 Main St, Powell, OH 43065"), true);
  assert.equal(isCompleteAddress("123 Main St, Powell, OH 43065-1234"), true);
  assert.equal(isCompleteAddress("Main Street, Powell, OH 43065"), false);
});

test("direct API requests cannot create, update or register with incomplete addresses", async () => {
  const base = process.env.TEST_BASE_URL ?? "http://localhost:8080";
  const request = async (path, method, body) => {
    const response = await fetch(new URL(path, base), {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const incomplete = await request("/api/admin/members", "POST", {
    name: "Address check invalid", address: "123 Main Street",
  });
  assert.equal(incomplete.status, 400);

  const phone = `614${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
  const originalAddress = "123 Main St, Powell, OH 43065";
  const created = await request("/api/admin/members", "POST", {
    name: "Address validation test", phone, address: originalAddress,
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  try {
    const patch = await request(`/api/admin/members/${id}`, "PATCH", {
      address: "123 Main Street",
    });
    assert.equal(patch.status, 400);

    const registration = await request("/api/admin/students", "POST", {
      firstName: "Address", lastName: "Test", memberId: id,
      address: "123 Main Street", enrollments: [],
    });
    assert.equal(registration.status, 400);

    const otherAddress = await request("/api/admin/students", "POST", {
      firstName: "Address", lastName: "Test", memberId: id,
      address: "456 Other Rd, Dublin, OH 43017", enrollments: [],
    });
    assert.equal(otherAddress.status, 400);

    const member = await request(`/api/admin/members/${id}`, "GET");
    assert.equal(member.status, 200);
    assert.equal(member.body.address, originalAddress);
  } finally {
    const deleted = await request(`/api/admin/members/${id}`, "DELETE");
    assert.equal(deleted.status, 200);
  }
});