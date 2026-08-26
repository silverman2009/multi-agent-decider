import type { Metadata } from "next";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import "./globals.css";

export const metadata: Metadata = {
  title: "تصمیم‌یار چندعاملی",
  description: "سیستم تصمیم‌یار چندعاملی با ارکستراتور، عامل‌های تخصصی و داور نهایی",
};

const NAV_ITEMS = [
  { href: "/", label: "داشبورد" },
  { href: "/decisions/new", label: "تصمیم جدید" },
  { href: "/agents", label: "عامل‌ها" },
  { href: "/settings", label: "تنظیمات" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight text-emerald-700">
              تصمیم‌یار چندعاملی
            </Link>
            <nav className="flex items-center gap-1 sm:gap-2">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
