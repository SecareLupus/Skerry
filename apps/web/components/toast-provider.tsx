"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface Toast {
    id: string;
    message: string;
    type: "info" | "success" | "warning" | "error";
    actionLabel?: string;
    onAction?: () => void;
    duration?: number;
}

interface ToastContextType {
    showToast: (message: string, type?: Toast["type"], action?: { label: string; onClick: () => void }, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((
        message: string, 
        type: Toast["type"] = "info", 
        action?: { label: string; onClick: () => void }, 
        duration = 5000
    ) => {
        const id = Math.random().toString(36).slice(2, 9);
        setToasts((prev) => [...prev, { 
            id, 
            message, 
            type, 
            actionLabel: action?.label, 
            onAction: action?.onClick,
            duration
        }]);
        
        if (duration > 0) {
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, duration);
        }
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="toast-container">
                {toasts.map((toast) => (
                    <div key={toast.id} className={`toast toast-${toast.type}`} role="alert">
                        <div className="toast-content text-sm flex items-center gap-3 flex-grow">
                            <span>{toast.message}</span>
                            {toast.onAction && (
                                <button 
                                    className="toast-action-btn" 
                                    onClick={() => {
                                        toast.onAction?.();
                                        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                                    }}
                                >
                                    {toast.actionLabel || 'Action'}
                                </button>
                            )}
                        </div>
                        <button type="button" className="ml-2 hover:opacity-80 transition-opacity" onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}>
                            ×
                        </button>
                    </div>
                ))}
            </div>
            <style jsx>{`
                .toast-container {
                    position: fixed;
                    bottom: 24px;
                    left: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    z-index: 9999;
                }
                .toast {
                    background: #2b2d31;
                    color: white;
                    padding: 12px 16px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    min-width: 320px;
                    max-width: 440px;
                    animation: slideIn 0.2s ease;
                    border-left: 4px solid transparent;
                }
                .toast-success { border-left-color: #23a559; }
                .toast-error { border-left-color: #f23f43; }
                .toast-warning { border-left-color: #f0b232; }
                .toast-info { border-left-color: #5865f2; }
                
                .toast-action-btn {
                    background: #5865f2;
                    border: none;
                    color: white;
                    padding: 4px 10px;
                    border-radius: 4px;
                    font-size: 0.75rem;
                    cursor: pointer;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                    transition: filter 0.2s;
                }
                .toast-action-btn:hover {
                    filter: brightness(1.2);
                }
                @keyframes slideIn {
                    from { transform: translateX(-100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (context === undefined) {
        throw new Error("useToast must be used within a ToastProvider");
    }
    return context;
}
