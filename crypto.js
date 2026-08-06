/**
 * crypto.js — end-to-end encryption of the Drive payload (BLUEPRINT §7, §11).
 *
 * ── What this protects, and what it does not ───────────────────────────────
 * IndexedDB on this device stays PLAINTEXT, deliberately. The disk is already
 * covered by FileVault and a device passcode, and encrypting locally would cost
 * a passphrase prompt every session, an in-memory search index, and the
 * read-only lock — for a threat the operating system already handles.
 *
 * What it protects is the copy on Drive. That is account numbers, policy
 * numbers and utility contracts sitting on someone else's disk, indefinitely,
 * readable by anyone who reaches the Google account. Encrypting there is cheap
 * and the exposure is permanent, which is the whole argument.
 *
 * ── The shape on the wire ──────────────────────────────────────────────────
 *   { v: 2, enc: "AES-GCM", kdf: { name: "PBKDF2", hash: "SHA-256",
 *     iterations, salt }, iv, ct }
 *
 * The salt travels WITH the payload. A second device has no other way to
 * derive the same key from the same passphrase — it has never seen this one
 * before, and a salt is not a secret.
 *
 * AES-GCM is authenticated, so a wrong passphrase fails to decrypt rather than
 * returning plausible nonsense. That is what makes "wrong passphrase" a
 * reportable error instead of silent corruption.
 *
 * ── The one irreversible part ──────────────────────────────────────────────
 * The passphrase is never stored, never synced and never recoverable. Lose it
 * and every backup on Drive is lost with it. The UI says so before switching
 * this on, and offers a sheet to print.
 */

/** Version marker written into every envelope this module produces. */
export const PAYLOAD_VERSION = 2;

/**
 * PBKDF2 rounds. OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 600,000; this
 * sits there rather than at the older 310,000 because the cost is paid once
 * per unlock, not per sync, and a passphrase people can remember needs the
 * help.
 */
export const KDF_ITERATIONS = 600000;

const SALT_BYTES = 16;
const IV_BYTES = 12; // 96 bits, the size AES-GCM is specified for

/** Magic header on an encrypted attachment, so a plaintext one still reads. */
const MEDIA_MAGIC = "HMSE1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function cryptoAvailable() {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

// ═══════════════════════════════════════════════════════════════════════════
// base64 — the envelope is JSON, so the bytes have to be text
// ═══════════════════════════════════════════════════════════════════════════

export function toBase64(bytes) {
  let binary = "";
  const view = new Uint8Array(bytes);
  // Chunked: String.fromCharCode(...view) blows the argument limit somewhere
  // around a hundred thousand bytes, and an attachment is far larger.
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(String(text || ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Keys
// ═══════════════════════════════════════════════════════════════════════════

/** A fresh random salt for a brand-new passphrase. */
export function makeSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/**
 * Derive the AES key from a passphrase and salt.
 *
 * `extractable: false` on purpose. The derived key is stored in IndexedDB so
 * the passphrase is not demanded every session, and a non-extractable key
 * cannot be read back out of the database by anything — including this app.
 * It can only be used to encrypt and decrypt.
 */
export async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: Number(iterations) || KDF_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The JSON envelope — items.json and the backups
// ═══════════════════════════════════════════════════════════════════════════

/** True when `parsed` is an envelope this module wrote. PURE. */
export function isEnvelope(parsed) {
  return !!(
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    parsed.enc === "AES-GCM" &&
    typeof parsed.ct === "string" &&
    typeof parsed.iv === "string"
  );
}

/** Salt and iteration count out of an envelope, so a second device can derive. */
export function envelopeKdf(parsed) {
  const kdf = (parsed && parsed.kdf) || {};
  return {
    salt: fromBase64(kdf.salt),
    iterations: Number(kdf.iterations) || KDF_ITERATIONS,
  };
}

/** Encrypt a value to an envelope object. */
export async function encryptPayload(value, key, salt, iterations = KDF_ITERATIONS) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    v: PAYLOAD_VERSION,
    enc: "AES-GCM",
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: toBase64(salt),
    },
    iv: toBase64(iv),
    ct: toBase64(ct),
  };
}

/**
 * Decrypt an envelope back to its value.
 * Throws on a wrong key — GCM authenticates, so this cannot return rubbish.
 */
export async function decryptPayload(envelope, key) {
  const iv = fromBase64(envelope.iv);
  const ct = fromBase64(envelope.ct);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(decoder.decode(plaintext));
}

// ═══════════════════════════════════════════════════════════════════════════
// Attachments — bytes, not JSON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encrypt a blob to `MAGIC | iv | ciphertext`.
 *
 * Self-describing on purpose: attachments uploaded before encryption was
 * switched on are still sitting on Drive in the clear, and a reader has to be
 * able to tell the two apart without being told which is which.
 */
export async function encryptBlob(blob, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    await blob.arrayBuffer()
  );
  return new Blob([encoder.encode(MEDIA_MAGIC), iv, new Uint8Array(ct)], {
    type: "application/octet-stream",
  });
}

/** True if these bytes carry our header. */
export async function isEncryptedBlob(blob) {
  if (!blob || blob.size < MEDIA_MAGIC.length + IV_BYTES) return false;
  const head = new Uint8Array(await blob.slice(0, MEDIA_MAGIC.length).arrayBuffer());
  return decoder.decode(head) === MEDIA_MAGIC;
}

/**
 * Decrypt a blob written by encryptBlob, or hand back one that was never
 * encrypted. `type` restores the MIME type, which the ciphertext cannot carry.
 */
export async function decryptBlob(blob, key, type = "application/octet-stream") {
  if (!(await isEncryptedBlob(blob))) return blob;
  const iv = new Uint8Array(
    await blob.slice(MEDIA_MAGIC.length, MEDIA_MAGIC.length + IV_BYTES).arrayBuffer()
  );
  const ct = await blob.slice(MEDIA_MAGIC.length + IV_BYTES).arrayBuffer();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Blob([plain], { type });
}
