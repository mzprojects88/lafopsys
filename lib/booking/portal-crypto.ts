// Relative imports only: `node --test` loads this file without the @/ alias. Server use only (node:crypto).
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * The secrets of the Volunteers Portal (0182): one-time passwords, the group's own password, session tokens.
 * Passwords are kept as salted scrypt hashes; one-time passwords and session tokens only as SHA-256. Nothing here
 * logs or returns a secret except the one-time password, once, to the staff member who issued it.
 */

/** No 0/O, 1/I/L: read aloud or typed from a message without mistakes. */
const OTP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export const sha256hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** A one-time password like "K7QMX-4WD2P": 10 characters (about 50 bits), shown to staff once. */
export function makeOtp(): string {
  const chars = Array.from({ length: 10 }, () => OTP_ALPHABET[randomInt(OTP_ALPHABET.length)]);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

/** A one-time password as typed (spaces, dashes, small letters) in the form it was hashed. */
export const normalizeOtp = (typed: string): string => typed.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The hash kept for a one-time password. */
export const otpHash = (otp: string): string => sha256hex(normalizeOtp(otp));

/** Why a new password is not accepted, or "" when it is. */
export function passwordProblem(password: string): string {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (normalizeOtp(password).length === 10 && /^[A-Z0-9-]+$/.test(password.toUpperCase()) && /-/.test(password)) return "Choose a password of your own, not the one-time password.";
  return "";
}

/** scrypt$N$r$p$salt$hash (base64url). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, "base64url");
  if (!want.length) return false;
  const got = scryptSync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(got, want);
}

/** Two hex hashes compared in constant time. */
export function sameHash(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** A session token for the cookie (32 random bytes); only its SHA-256 is stored. */
export const makeToken = (): string => randomBytes(32).toString("base64url");
