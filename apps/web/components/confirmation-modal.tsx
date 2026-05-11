"use client";

import React, { useState, useEffect } from "react";
import Icon from "../components/icon";
import { useChat } from "../context/chat-context";

export function ConfirmationModal() {
    const { state, dispatch } = useChat();
    const { confirmationContext } = state;
    const [reason, setReason] = useState("");

    useEffect(() => {
        if (confirmationContext) {
            setReason("");
        }
    }, [confirmationContext]);

    if (!confirmationContext) return null;

    const {
        title,
        message,
        confirmLabel = "Confirm",
        cancelLabel = "Cancel",
        danger = false,
        requiresReason = false,
        reasonPlaceholder = "Provide a reason...",
        onConfirm,
        onCancel
    } = confirmationContext;

    const handleConfirm = () => {
        onConfirm(requiresReason ? reason : undefined);
        dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
        dispatch({ type: "SET_CONFIRMATION", payload: null });
    };

    const handleCancel = () => {
        if (onCancel) onCancel();
        dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
        dispatch({ type: "SET_CONFIRMATION", payload: null });
    };

    return (
        <div className="modal-overlay" onClick={handleCancel}>
            <div className="modal-card glass-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className={danger ? 'danger' : ''}>{title}</h2>
                    <button className="close-button" onClick={handleCancel}><Icon name="x" size={16} /></button>
                </div>
                
                <div className="modal-body">
                    <p className="message">{message}</p>
                    <hr className="divider" />

                    {requiresReason && (
                        <div className="reason-field">
                            <label>Reason for Action</label>
                            <textarea
                                placeholder={reasonPlaceholder}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                autoFocus
                            />
                        </div>
                    )}

                    <div className="modal-actions">
                        <button
                            className="secondary-button"
                            onClick={handleCancel}
                        >
                            {cancelLabel}
                        </button>
                        <button
                            className={`action-button ${danger ? 'danger-button' : 'primary-button'}`}
                            onClick={handleConfirm}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
            <style jsx>{`
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    animation: fade-in 0.2s ease-out;
                }
                .modal-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    width: 100%;
                    max-width: 440px;
                    border-radius: 16px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                    overflow: hidden;
                    animation: slide-up 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
                }
                .glass-modal {
                    background: rgba(var(--bg-rgb), 0.8);
                    backdrop-filter: blur(12px) saturate(180%);
                    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
                }
                .modal-header {
                    padding: 24px 24px 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-header h2 {
                    margin: 0;
                    font-size: 1.25rem;
                    font-weight: 700;
                    color: var(--text);
                }
                .modal-header h2.danger {
                    color: var(--danger);
                }
                .close-button {
                    background: var(--surface-alt);
                    border: none;
                    color: var(--text-muted);
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .close-button:hover {
                    background: var(--border);
                    color: var(--text);
                }
                .modal-body {
                    padding: 0 24px 24px;
                }
                .message {
                    color: var(--text-muted);
                    font-size: 0.95rem;
                    line-height: 1.6;
                    margin-bottom: 20px;
                }
                .divider {
                    border: none;
                    border-top: 1px solid var(--border);
                    margin: 0 0 20px;
                    opacity: 0.3;
                }
                .reason-field {
                    margin-bottom: 20px;
                }
                .reason-field label {
                    display: block;
                    font-size: 0.75rem;
                    font-weight: 700;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 8px;
                }
                textarea {
                    background: var(--bg-strong);
                    border: 1px solid var(--border);
                    color: var(--text);
                    padding: 12px;
                    border-radius: 8px;
                    font-family: inherit;
                    width: 100%;
                    min-height: 100px;
                    resize: none;
                    transition: border-color 0.2s;
                }
                textarea:focus {
                    outline: none;
                    border-color: var(--accent);
                }
                .modal-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    margin-top: 12px;
                }
                .action-button, .secondary-button {
                    padding: 10px 20px;
                    border-radius: 8px;
                    border: none;
                    font-weight: 600;
                    font-size: 0.9rem;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .primary-button {
                    background: var(--accent);
                    color: white;
                }
                .primary-button:hover {
                    filter: brightness(1.1);
                    transform: translateY(-1px);
                }
                .danger-button {
                    background: var(--danger);
                    color: white;
                }
                .danger-button:hover {
                    filter: brightness(1.1);
                    transform: translateY(-1px);
                }
                .secondary-button {
                    background: transparent;
                    color: var(--text);
                    border: 1px solid var(--border);
                }
                .secondary-button:hover {
                    background: var(--surface-alt);
                }
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slide-up {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
