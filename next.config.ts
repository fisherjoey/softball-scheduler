import type { NextConfig } from "next";

// Everything this app serves is either a private team page or a static asset,
// so the security headers can be strict and global.
//
// CSP notes:
// - `script-src 'self' 'unsafe-inline'` — the App Router injects inline
//   bootstrap scripts into every page; without 'unsafe-inline' the app does
//   not hydrate at all. 'self' still blocks third-party script injection.
// - `style-src 'self' 'unsafe-inline'` — React writes inline style
//   attributes, and Tailwind's dev overlay injects style tags.
// - `img-src 'self' data: blob:` — the lineup-export canvas hands the share
//   sheet a blob/data URL image.
// - `frame-ancestors 'none'` — nobody embeds this app in an iframe; kills
//   clickjacking (supersedes X-Frame-Options).
// - `base-uri 'none'` — an injected <base> tag can't redirect relative URLs.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Invite URLs carry bearer tokens; never leak any of our URLs in a
          // Referer header to anywhere.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // Never MIME-sniff a response into something executable.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
        ],
      },
      {
        // Cache-Control only on the authenticated pages: everything except
        // Next's fingerprinted assets and the public icons/manifest (the same
        // set the middleware matcher excludes). Those stay cacheable; the
        // pages hold team data behind a cookie and a shared or back-button
        // cache copy would outlive the session that fetched it.
        source: '/((?!_next/|favicon\\.ico|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest).*)',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ]
  },
};

export default nextConfig;
