import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "IntegraMEI | Acesse sua conta",
  description:
    "Acesse sua conta IntegraMEI.",
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