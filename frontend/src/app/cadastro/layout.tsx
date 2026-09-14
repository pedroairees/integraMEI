import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "IntegraMEI | Criar conta",
  description: "Crie sua conta IntegraMEI.",
};

export default function RegisterLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
