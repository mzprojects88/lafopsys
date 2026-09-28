import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { plainError } from "../lib/utils/plain-error.ts";

describe("plainError", () => {
  it("translates database and network wording", () => {
    assert.equal(plainError('new row violates row-level security policy for table "stays"'), "You don't have permission to do this. Ask an admin if you should.");
    assert.equal(plainError("TypeError: Failed to fetch"), "No connection. Check the internet and try again.");
    assert.equal(plainError('duplicate key value violates unique constraint "x"'), "This was already saved, or is taken by someone else. Refresh to see the latest.");
    assert.equal(plainError("JWT expired"), "You were signed out. Sign in again, then try once more.");
  });

  it("keeps our own plain sentences", () => {
    assert.equal(plainError("Room 1 is a women's room now"), "Room 1 is a women's room now");
    assert.equal(plainError("Bed B6 is taken"), "Bed B6 is taken");
  });

  it("never shows an empty message", () => {
    assert.equal(plainError(""), "Something went wrong. Try again.");
    assert.equal(plainError(undefined), "Something went wrong. Try again.");
  });
});
