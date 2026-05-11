import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skerry Chat",
  description: "Skerry Collective Matrix hub",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Skerry Chat",
  },
  icons: {
    apple: "/icons/icon-192x192.png",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#2d3748",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

import { ToastProvider } from "../components/toast-provider";
import { ChatProvider } from "../context/chat-context";
import { DynamicManifest } from "../components/dynamic-manifest";
import { ModalManager } from "../components/modal-manager";
import { AppInitializer } from "../components/app-initializer";
import { ThemeScript } from "../components/theme-script";
import { MasqueradeBanner } from "../components/masquerade-banner";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeScript />
        <ToastProvider>
          <ChatProvider>
            <DynamicManifest />
            <MasqueradeBanner />
            <AppInitializer>
              {children}
            </AppInitializer>
          </ChatProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
