'use client'

import { useState } from 'react'
import { createInviteLink, type InviteLink } from './actions'

const BUTTON =
  'flex h-11 w-full items-center justify-center rounded-md border-2 px-4 text-sm font-semibold disabled:opacity-60 sm:w-auto sm:self-start'
const PRIMARY =
  'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
const SECONDARY = 'border-zinc-400 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300'

/** "26 August" — the date is the only thing anyone needs off it. */
function inWords(expiresAtMs: number): string {
  return new Date(expiresAtMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/**
 * Generates a link that logs the other captain in without being told the
 * shared password.
 *
 * The copy under the button is deliberately blunt. This is a bearer link:
 * anyone holding it is in, it keeps working until it expires rather than
 * burning on first use, and there is no per-person revoke — only changing
 * SESSION_SECRET, which signs out everybody including you. Saying that plainly
 * is the difference between the owner texting it to one person and the owner
 * pasting it into a team-wide group chat.
 */
export function ShareAccess() {
  const [link, setLink] = useState<InviteLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setError(null)
    setCopied(false)
    setBusy(true)
    try {
      setLink(await createInviteLink())
    } catch {
      setError('Could not create a link. Reload the page and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setError('Could not reach the clipboard. Select the link above and copy it by hand.')
    }
  }

  return (
    <details className="rounded-lg border border-zinc-300 dark:border-zinc-700">
      <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 py-3 text-base font-medium text-foreground">
        Share access
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        <p>
          Sends someone straight in without telling them the password — for the other captain, say.
        </p>

        <button type="button" onClick={generate} disabled={busy} className={`${BUTTON} ${PRIMARY}`}>
          {busy ? 'Making a link…' : link ? 'Make another link' : 'Make a link'}
        </button>

        {link && (
          <div className="flex flex-col gap-2">
            <label htmlFor="invite-link" className="font-medium text-foreground">
              Send them this
            </label>
            <input
              id="invite-link"
              type="text"
              readOnly
              value={link.url}
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 text-sm text-foreground dark:border-zinc-700"
            />
            <button type="button" onClick={copy} className={`${BUTTON} ${SECONDARY}`}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <p className="text-zinc-600 dark:text-zinc-400">
              Works until {inWords(link.expiresAtMs)}.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <p className="text-zinc-600 dark:text-zinc-400">
          Anyone who has the link gets in — it is not tied to a person, and it keeps working every
          time it is opened until the date above, not just once. Forwarded on, it still works. To
          kill it early you have to change <code>SESSION_SECRET</code>, which signs everyone out,
          you included.
        </p>
      </div>
    </details>
  )
}
