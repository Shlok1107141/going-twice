"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** The page's `?room=` value ("" on the server and when absent). */
export function useRoom(): string {
  return useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get("room") ?? "",
    () => "",
  );
}

export function withRoom(href: string, room: string): string {
  return room ? `${href}?room=${encodeURIComponent(room)}` : href;
}

export const PAGES = [
  { href: "/stage", label: "Stage" },
  { href: "/paddle", label: "Paddle" },
  { href: "/admin", label: "Admin" },
  { href: "/report", label: "Report" },
  { href: "/timeline", label: "Timeline" },
] as const;

export function Wordmark({ size = "md", tone = "ink" }: { size?: "md" | "lg"; tone?: "ink" | "light" }) {
  const text = size === "lg" ? "text-3xl" : "text-[22px]";
  return (
    <span className={`inline-flex items-center gap-2 ${tone === "light" ? "text-canvas" : "text-ink"}`}>
      <svg aria-hidden viewBox="0 0 20 20" className={size === "lg" ? "h-6 w-6" : "h-[18px] w-[18px]"}>
        <rect x="4" y="4" width="12" height="12" rx="2" transform="rotate(45 10 10)" fill="var(--clay)" />
        <rect x="8" y="8" width="4" height="4" rx="0.8" transform="rotate(45 10 10)" fill="var(--canvas)" />
      </svg>
      <span className={`display ${text} font-semibold leading-none tracking-tight`}>Going Twice</span>
    </span>
  );
}

/** Top navigation for every page except the projector stage. Links keep the current `?room=`. */
export function SiteNav() {
  const pathname = usePathname();
  const room = useRoom();
  if (pathname === "/stage") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:h-[var(--nav-h)] sm:flex-nowrap sm:px-6 sm:py-0"
      >
        <Link href={withRoom("/", room)} className="shrink-0 rounded-sm" aria-label="Going Twice, home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-3">
          {room && (
            <span className="hidden rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-xs text-ink-2 md:inline" title="Auction room">
              Room {room.toUpperCase()}
            </span>
          )}
        </div>
        <ul className="-mx-2 flex w-full items-center justify-between sm:mx-0 sm:w-auto sm:justify-end sm:gap-1">
          {PAGES.map((p) => {
            const active = pathname === p.href;
            return (
              <li key={p.href}>
                <Link
                  href={withRoom(p.href, room)}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-2 py-1.5 text-[14px] transition-colors sm:px-3 ${
                    active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink"
                  }`}
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
