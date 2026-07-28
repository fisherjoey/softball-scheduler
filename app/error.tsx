'use client'

/**
 * Route-level error boundary — the backstop for anything a form didn't catch
 * (a server action throwing on garbled input, the database dropping out at
 * the diamond). Without it Next shows its unstyled default, which on a phone
 * mid-game reads as "the app is gone". `reset()` re-renders the segment,
 * which is usually all a flaky connection needs.
 */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Deliberately no error.message: in production Next redacts server-side
  // messages to a boilerplate paragraph about omitted specifics, which reads
  // worse than saying nothing. The real detail is in the server logs.
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        The app hit a problem it could not recover from. Your saved data is fine — try again, and
        if it keeps happening, reload the page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="flex h-11 items-center justify-center rounded-md bg-zinc-900 px-6 text-base font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Try again
      </button>
    </main>
  )
}
