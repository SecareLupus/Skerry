"use client";

import { useEffect, useRef } from "react";

/**
 * Registers the service worker and subscribes to push notifications
 * if the browser supports it. Fetches the VAPID public key from the
 * control plane so it stays in sync with the server's keypair.
 */
export function PushSubscriber() {
    const subscribedRef = useRef(false);

    useEffect(() => {
        if (subscribedRef.current) return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

        async function register() {
            try {
                const registration = await navigator.serviceWorker.register("/sw.js");
                await navigator.serviceWorker.ready;

                const existingSubscription = await registration.pushManager.getSubscription();
                if (existingSubscription) {
                    subscribedRef.current = true;
                    return;
                }

                // Fetch the server's VAPID public key
                const keyResp = await fetch("/v1/push/vapid-public-key");
                if (!keyResp.ok) {
                    console.warn("[push] VAPID key not available, skipping subscription");
                    return;
                }
                const { publicKey } = await keyResp.json() as { publicKey: string };

                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
                });

                const rawKey = subscription.getKey("p256dh");
                const rawAuth = subscription.getKey("auth");
                if (!rawKey || !rawAuth) return;

                await fetch("/v1/push/subscribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        endpoint: subscription.endpoint,
                        keys: {
                        p256dh: btoa(String.fromCharCode(...new Uint8Array(rawKey as ArrayBuffer))),
                        auth: btoa(String.fromCharCode(...new Uint8Array(rawAuth as ArrayBuffer))),
                        },
                    }),
                });

                subscribedRef.current = true;
            } catch (err) {
                console.warn("[push] subscription failed:", err);
            }
        }

        void register();
    }, []);

    return null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
