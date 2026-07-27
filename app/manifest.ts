import type { MetadataRoute } from 'next'

/**
 * Makes "Add to Home Screen" produce something that looks like an app rather
 * than a browser bookmark — which matters, because this is used one-handed at
 * the side of a diamond and every pixel of browser chrome is a pixel not
 * showing the lineup.
 *
 * `standalone` drops the URL bar. `portrait` because every screen in here is a
 * vertical list or a table you scroll.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Big Bats — Lineups',
    short_name: 'Big Bats',
    description: 'Legal, fair lineups for Calgary Sport & Social Club co-ed slo-pitch.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0a',
    theme_color: '#18181b',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
