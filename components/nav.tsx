'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavLink {
  href: string
  label: string
}

interface NavProps {
  /**
   * Href of the game currently in progress, once game routes exist. A later
   * task (server-rendered layout) can look this up and pass it down; until
   * then it's omitted and the tab simply doesn't render.
   */
  activeGameHref?: string
}

const BASE_LINKS: NavLink[] = [
  { href: '/roster', label: 'Roster' },
  { href: '/games', label: 'Games' },
]

export function Nav({ activeGameHref }: NavProps) {
  const pathname = usePathname()

  // The login screen has no session yet, so there's nothing to navigate to.
  if (pathname === '/login') return null

  const links = activeGameHref
    ? [...BASE_LINKS, { href: activeGameHref, label: 'Live Game' }]
    : BASE_LINKS

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-zinc-200 bg-background pb-[env(safe-area-inset-bottom)] sm:static sm:border-t-0 sm:border-b dark:border-zinc-800"
    >
      {links.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-1 items-center justify-center py-3 text-sm font-medium sm:flex-none sm:px-6 ${
              isActive ? 'text-foreground' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
