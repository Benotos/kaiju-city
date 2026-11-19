import type { Metadata, Viewport } from "next";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kaiju City — The market is alive",
  description: "A cinematic 3D city built and wrecked by live Solana trades.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#07051a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
