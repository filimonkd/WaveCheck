import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const SCHEME = "scrypt";
const KEY_LENGTH = 64;

/**
 * Password hashing, isolated behind two functions so the algorithm can be
 * swapped without touching the auth flow.
 *
 * This uses Node's built-in scrypt rather than bcrypt: it needs no extra
 * dependency and no native build step, and it keeps the credentials provider
 * from having to compare plaintext in the meantime. Stored hashes carry their
 * scheme as a prefix, so a later move to bcrypt can detect and re-hash the
 * old ones on next successful sign-in.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${SCHEME}:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [scheme, salt, keyHex] = storedHash.split(":");

  if (scheme !== SCHEME || !salt || !keyHex) {
    return false;
  }

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, salt, expected.length);

  // Lengths must match before timingSafeEqual, which throws otherwise.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
