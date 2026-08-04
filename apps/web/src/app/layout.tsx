import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "CalmBoard — منصة إدارة المشاريع والعمل الجماعي",
  description: "منصة SaaS عصرية لإدارة المشاريع والمهام والعمل الجماعي — سريعة، آمنة، تدعم العربية والإنجليزية",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CalmBoard",
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('calmboard-theme');var l=localStorage.getItem('calmboard-locale')||'ar';var dark=t ? t==='dark' : false;document.documentElement.classList.toggle('dark',dark);document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#08080d] dark:text-zinc-100 antialiased selection:bg-indigo-500/20 selection:text-indigo-600 dark:selection:text-indigo-300">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
