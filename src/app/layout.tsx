import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "弱点単語集",
  description: "TOEIC単語学習アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const item = localStorage.getItem('vocab_settings');
                let zoom = 1.5;
                let theme = 'system';
                if (item) {
                  const parsed = JSON.parse(item);
                  if (parsed.zoom) zoom = parsed.zoom;
                  if (parsed.theme) theme = parsed.theme;
                }
                document.documentElement.setAttribute('data-theme', theme);
                if (window.innerWidth >= 768) {
                  document.documentElement.style.zoom = String(zoom);
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} font-sans antialiased bg-gray-50 text-gray-900`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const item = localStorage.getItem('vocab_settings');
                let zoom = 1.5;
                if (item) {
                  const parsed = JSON.parse(item);
                  if (parsed.zoom) zoom = parsed.zoom;
                }
                if (window.innerWidth < 768) {
                  document.body.style.zoom = String(zoom);
                }
              } catch (e) {}
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
