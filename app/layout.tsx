import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kaiju City — The market is alive",
  description: "A cinematic 3D city built and flattened by live Solana trades.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#071117" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
