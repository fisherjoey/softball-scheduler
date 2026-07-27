import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // `template` gives every page a suffixed title without each one repeating
  // the app name; `default` covers pages that set none.
  title: {
    default: "Big Bats — Lineups",
    template: "%s — Big Bats",
  },
  description:
    "Builds a legal, fair fielding grid and batting order for Calgary Sport & Social Club co-ed slo-pitch.",
  applicationName: "Big Bats",
  // The app is behind a password and holds a roster of real people's names.
  // Keep it out of search results.
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Big Bats",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Matches the app background so the phone's status bar and the pull-to-refresh
  // overscroll do not flash white against a dark page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT locking zoom: pinching a 7x10 grid is a legitimate thing
  // to want, and disabling it is an accessibility failure.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        <div className="flex flex-1 flex-col pb-16 sm:pb-0">{children}</div>
      </body>
    </html>
  );
}
