import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "満満菓 Manmango Shop",
  description: "日本精選伴手禮與禮盒預購",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
