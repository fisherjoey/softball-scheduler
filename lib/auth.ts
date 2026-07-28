// The secret this module signs with must never reach a client bundle. The
// marker is safe in the Edge middleware bundle too: Next resolves the
// middleware layer with react-server conditions, under which `server-only`
// is the empty module.
import 'server-only'

/**
 * Session token signing/verification for the single shared-password gate.
 *
 * Implemented with the Web Crypto API (`crypto.subtle`) rather than Node's
 * `crypto` module because this code has to run identically in two places:
 * Next.js middleware (Edge runtime, no `node:crypto`) and server actions
 * (Node runtime). Web Crypto is the intersection.
 *
 * Token shape: `<issuedAtMs>.<base64url HMAC-SHA256 of issuedAtMs>`.
 *
 * Invite tokens (the shareable link) live here too and look the same, but the
 * signed message is prefixed — see `INVITE_PREFIX` below.
 */

export const SESSION_COOKIE = 'softball_session'

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Domain separator for invite tokens.
 *
 * Both token families are `<number>.<HMAC>` over the same secret, so without
 * this the two would be interchangeable: an invite link's token pasted into
 * the session cookie would authenticate forever, and a stolen session cookie
 * would redeem as an invite. Signing `invite:<expiresAtMs>` instead of the
 * bare number means a signature produced for one family can never validate
 * against the other, whatever the number happens to be.
 */
const INVITE_PREFIX = 'invite:'

/**
 * Ceiling on how far ahead an invite may expire.
 *
 * The expiry is carried in the token and is therefore attacker-visible — but
 * it is covered by the HMAC, so nobody can push it out without the secret.
 * The cap is a guard against our own side: a bug (or a fat-fingered call)
 * that mints a link good until the year 9999 is a permanent credential, and
 * this refuses to honour one. Generous enough for the 7-day default.
 */
const MAX_INVITE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Entropy floor for the signing secret.
 *
 * Invite links put HMAC tags in third parties' hands (text messages, browser
 * histories), so the secret is exposed to offline guessing with no rate limit
 * and no logging. A human-chosen passphrase falls to that. 32 characters is
 * the point where even a low-entropy character set is out of reach; refusing
 * shorter turns a weak deployment into a loud startup error instead of a
 * quiet vulnerability.
 */
const MIN_SECRET_LENGTH = 32

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not set')
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters — generate a random one, do not use a passphrase`,
    )
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

/**
 * Timing-safe string comparison for the password check.
 *
 * Both sides are SHA-256-digested before comparing rather than fed to
 * `constantTimeEqual` raw: its length check is fine for HMACs (fixed, public
 * length) but on passwords it would answer "is your guess the right length?"
 * faster than "is it the right password?" — a password-length oracle.
 * Digests are always 32 bytes, so every comparison walks the same bytes in
 * the same time whatever the inputs look like.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const digest = async (value: string): Promise<Uint8Array> =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return constantTimeEqual(await digest(a), await digest(b))
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

/**
 * Signs an invite token that stops working at `expiresAtMs`.
 *
 * Deliberately signs whatever it is handed, including an expiry in the past
 * or one absurdly far out — same reason `signSessionAt` takes an arbitrary
 * time. All the refusing happens in `verifyInvite`, which is the side that
 * faces untrusted input; keeping the signer dumb lets tests mint the bad
 * tokens they need to prove the verifier rejects them.
 */
export async function signInvite(expiresAtMs: number): Promise<string> {
  const signature = await sign(`${INVITE_PREFIX}${expiresAtMs}`)
  return `${expiresAtMs}.${toBase64Url(signature)}`
}

export async function verifyInvite(token: string | undefined): Promise<boolean> {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [expiresAtRaw, signatureRaw] = parts

  if (!/^\d+$/.test(expiresAtRaw)) return false
  const expiresAtMs = Number(expiresAtRaw)
  if (!Number.isSafeInteger(expiresAtMs)) return false

  const remaining = expiresAtMs - Date.now()
  if (remaining <= 0 || remaining > MAX_INVITE_LIFETIME_MS) return false

  const providedSignature = fromBase64Url(signatureRaw)
  if (!providedSignature) return false

  const expectedSignature = await sign(`${INVITE_PREFIX}${expiresAtRaw}`)
  return constantTimeEqual(expectedSignature, providedSignature)
}
