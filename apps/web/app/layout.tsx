import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skerry Chat",
  description: "Skerry Collective Matrix hub"
};

import { ToastProvider } from "../components/toast-provider";
import { ChatProvider } from "../context/chat-context";
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
