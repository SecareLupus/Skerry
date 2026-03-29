"use client";

import React, { useState, useEffect } from "react";
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
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className={danger ? 'danger' : ''}>{title}</h2>
                    <button className="close-button" onClick={handleCancel}>✕</button>
                </div>
                
                <div className="modal-body">
                    <p className="message">{message}</p>

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
                    background: rgba(0, 0, 0, 0.85);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 11000;
                }
                .modal-card {
                    background: #313338;
                    width: 100%;
                    max-width: 440px;
                    border-radius: 8px;
                    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
                    overflow: hidden;
                    animation: modal-in 0.2s ease-out;
                }
                .modal-header {
                    padding: 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-header h2 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 700;
                    color: white;
                }
                .modal-header h2.danger {
                    color: #f23f43;
                }
                .close-button {
                    background: none;
                    border: none;
                    color: #b5bac1;
                    font-size: 20px;
                    cursor: pointer;
                    padding: 4px;
                }
                .modal-body {
                    padding: 0 16px 16px;
                }
                .message {
                    color: #dbdee1;
                    line-height: 1.5;
                    margin-bottom: 20px;
                }
                .reason-field {
                    margin-bottom: 20px;
                }
                .reason-field label {
                    display: block;
                    font-size: 12px;
                    font-weight: 700;
                    color: #b5bac1;
                    text-transform: uppercase;
                    margin-bottom: 8px;
                }
                textarea {
                    background: #1e1f22;
                    border: none;
                    color: #dbdee1;
                    padding: 10px;
                    border-radius: 4px;
                    font-family: inherit;
                    width: 100%;
                    min-height: 100px;
                    resize: none;
                }
                textarea:focus {
                    outline: 2px solid #5865f2;
                }
                .modal-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    background: #2b2d31;
                    padding: 16px;
                    margin: 0 -16px -16px;
                }
                button {
                    padding: 10px 24px;
                    border-radius: 3px;
                    border: none;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .primary-button {
                    background: #5865f2;
                    color: white;
                }
                .primary-button:hover {
                    background: #4752c4;
                }
                .danger-button {
                    background: #da373c;
                    color: white;
                }
                .danger-button:hover {
                    background: #a1282c;
                }
                .secondary-button {
                    background: transparent;
                    color: white;
                }
                .secondary-button:hover {
                    text-decoration: underline;
                }
                @keyframes modal-in {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
