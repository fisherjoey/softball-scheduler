import { LoginForm } from './LoginForm'

export const metadata = {
  title: 'Sign in',
}

/**
 * Server wrapper so the page can read `?invite=invalid` — the flag the invite
 * redemption route sets when it turns a link away. Reading it here rather
 * than with `useSearchParams` in the form keeps the client component free of
 * a Suspense boundary it would otherwise need.
 */

const INVITE_INVALID =
  'That invite link has expired or is no longer valid. Ask for a new one, or sign in with the password.'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const { invite } = await searchParams
  return <LoginForm notice={invite === 'invalid' ? INVITE_INVALID : undefined} />
}
