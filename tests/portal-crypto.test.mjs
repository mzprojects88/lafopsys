// lib/booking/portal-crypto.ts: the Volunteers Portal's secrets (0182).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, makeOtp, makeToken, normalizeOtp, otpHash, passwordProblem, sameHash, sha256hex, verifyPassword } from "../lib/booking/portal-crypto.ts";

describe("portal secrets", () => {
  it("a one-time password is 10 unambiguous characters, and typed loosely it still matches", () => {
    const otp = makeOtp();
    assert.match(otp, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(normalizeOtp(` ${otp.toLowerCase().replace("-", " ")} `), otp.replace("-", ""));
    assert.equal(otpHash(otp.toLowerCase()), otpHash(otp));
    assert.notEqual(makeOtp(), makeOtp());
  });
  it("a password is kept salted: the same password gives two different hashes, both verify, a wrong one fails", () => {
    const a = hashPassword("correct horse battery");
    const b = hashPassword("correct horse battery");
    assert.notEqual(a, b);
    assert.match(a, /^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    assert.ok(verifyPassword("correct horse battery", a) && verifyPassword("correct horse battery", b));
    assert.ok(!verifyPassword("correct horse batterY", a));
    assert.ok(!verifyPassword("anything", null) && !verifyPassword("anything", "plain") && !verifyPassword("x", "scrypt$1$1$1$$"));
  });
  it("hashes are compared whole, and a token is long and random", () => {
    assert.ok(sameHash(sha256hex("t"), sha256hex("t")));
    assert.ok(!sameHash(sha256hex("t"), sha256hex("u")) && !sameHash(null, sha256hex("t")) && !sameHash("short", sha256hex("t")));
    assert.ok(makeToken().length >= 43 && makeToken() !== makeToken());
  });
  it("a new password must be long enough, and not the one-time password again", () => {
    assert.equal(passwordProblem("short"), "Use at least 10 characters.");
    assert.equal(passwordProblem("a".repeat(201)), "Use at most 200 characters.");
    assert.equal(passwordProblem("K7QMX-4WD2P"), "Choose a password of your own, not the one-time password.");
    assert.equal(passwordProblem("a long sentence of my own"), "");
  });
});
