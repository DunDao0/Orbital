import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbis Scientia — Sistema Solar verificável",
  description: "Planetário científico com N-body, efemérides rastreáveis e céu local.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
