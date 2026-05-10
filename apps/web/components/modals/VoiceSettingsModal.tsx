"use client";

import React, { useEffect, useState } from "react";
import Icon from "../icon";

interface VoiceSettingsModalProps {
    activeModal: string | null;
    onClose: () => void;
}

export function VoiceSettingsModal({ activeModal, onClose }: VoiceSettingsModalProps) {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedVideo, setSelectedVideo] = useState("");
    const [selectedAudioIn, setSelectedAudioIn] = useState("");
    const [selectedAudioOut, setSelectedAudioOut] = useState("");

    useEffect(() => {
        if (activeModal !== "voice-settings") return;

        const loadDevices = async () => {
            try {
                // Request permissions first to get labels
                await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                const devs = await navigator.mediaDevices.enumerateDevices();
                setDevices(devs);

                // Load saved preferences
                setSelectedVideo(localStorage.getItem("skerry_video_device") || "");
                setSelectedAudioIn(localStorage.getItem("skerry_audio_in_device") || "");
                setSelectedAudioOut(localStorage.getItem("skerry_audio_out_device") || "");
            } catch (err) {
                console.error("Failed to load devices", err);
            }
        };

        void loadDevices();
    }, [activeModal]);

    const handleSave = () => {
        localStorage.setItem("skerry_video_device", selectedVideo);
        localStorage.setItem("skerry_audio_in_device", selectedAudioIn);
        localStorage.setItem("skerry_audio_out_device", selectedAudioOut);
        onClose();
        // Note: VoiceRoom will pick these up on next mount or we could trigger a refresh
        window.location.reload(); // Simple way to apply to active LiveKit room for now
    };

    if (activeModal !== "voice-settings") return null;

    const videoDevices = devices.filter(d => d.kind === "videoinput");
    const audioInDevices = devices.filter(d => d.kind === "audioinput");
    const audioOutDevices = devices.filter(d => d.kind === "audiooutput");

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-panel" onClick={e => e.stopPropagation()}>
                <header className="modal-header">
                    <h2>Voice & Video Settings</h2>
                    <button className="ghost" onClick={onClose}>&times;</button>
                </header>

                <div className="modal-content" style={{ padding: "1.5rem" }}>
                    <div className="settings-group" style={{ marginBottom: "1.5rem" }}>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Camera</label>
                        <select 
                            value={selectedVideo} 
                            onChange={e => setSelectedVideo(e.target.value)}
                            style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                        >
                            <option value="">Default Camera</option>
                            {videoDevices.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 5)}`}</option>
                            ))}
                        </select>
                    </div>

                    <div className="settings-group" style={{ marginBottom: "1.5rem" }}>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Microphone</label>
                        <select 
                            value={selectedAudioIn} 
                            onChange={e => setSelectedAudioIn(e.target.value)}
                            style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                        >
                            <option value="">Default Microphone</option>
                            {audioInDevices.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 5)}`}</option>
                            ))}
                        </select>
                    </div>

                    <div className="settings-group" style={{ marginBottom: "2rem" }}>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Audio Output (Speakers)</label>
                        <select 
                            value={selectedAudioOut} 
                            onChange={e => setSelectedAudioOut(e.target.value)}
                            style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                        >
                            <option value="">Default Output</option>
                            {audioOutDevices.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 5)}`}</option>
                            ))}
                        </select>
                    </div>

                    <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
                        <button className="ghost" onClick={onClose}>Cancel</button>
                        <button className="primary" onClick={handleSave}>Save & Apply</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
