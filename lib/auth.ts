/**
 * Session token signing/verification for the single shared-password gate.
 *
 * Implemented with the Web Crypto API (`crypto.subtle`) rather than Node's
 * `crypto` module because this code has to run identically in two places:
 * Next.js middleware (Edge runtime, no `node:crypto`) and server actions
 * (Node runtime). Web Crypto is the intersection.
 *
 * Token shape: `<issuedAtMs>.<base64url HMAC-SHA256 of issuedAtMs>`.
 */

export const SESSION_COOKIE = 'softball_session'

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not set')
  }
  return secret
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function sign(message: string): Promise<Uint8Array> {
  const key = await hmacKey()
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return new Uint8Array(signature)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Returns null on malformed input rather than throwing, since input is untrusted. */
function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (padded.length % 4)) % 4
  try {
    const binary = atob(padded + '='.repeat(padLength))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * Constant-time byte comparison. Deliberately avoids `===` on strings and
 * avoids returning early inside the comparison loop — both would let an
 * attacker learn how many leading bytes matched from response timing. The
 * only early exit is the length check, which leaks no secret (HMAC-SHA256
 * output length is fixed and public).
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

/** Signs a session token for an arbitrary issue time. Exists so tests can
 * exercise expiry and timestamp-tampering without sleeping for 30 days. */
export async function signSessionAt(issuedAtMs: number): Promise<string> {
  const signature = await sign(String(issuedAtMs))
  return `${issuedAtMs}.${toBase64Url(signature)}`
}

export async function signSession(): Promise<string> {
  return signSessionAt(Date.now())
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [issuedAtRaw, signatureRaw] = parts

  if (!/^\d+$/.test(issuedAtRaw)) return false
  const issuedAtMs = Number(issuedAtRaw)
  if (!Number.isSafeInteger(issuedAtMs)) return false

  const age = Date.now() - issuedAtMs
  if (age < 0 || age > MAX_AGE_MS) return false

  const providedSignature = fromBase64Url(signatureRaw)
  if (!providedSignature) return false

  const expectedSignature = await sign(issuedAtRaw)
  return constantTimeEqual(expectedSignature, providedSignature)
}
