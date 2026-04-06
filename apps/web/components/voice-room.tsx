"use client";

import React, { useEffect, useRef, useState } from "react";
import {
    Room,
    RoomEvent,
    ParticipantEvent,
    RemoteParticipant,
    Participant,
    Track,
    TrackPublication,
    LocalTrackPublication,
    RemoteTrackPublication,
    LocalParticipant,
} from "livekit-client";
import type { VoiceTokenGrant } from "@skerry/shared";

interface VoiceRoomProps {
    grant: VoiceTokenGrant;
    muted: boolean;
    deafened: boolean;
    videoEnabled: boolean;
    onDisconnect: () => void;
}

export function VoiceRoom({ grant, muted, deafened, videoEnabled, onDisconnect }: VoiceRoomProps) {
    const [room, setRoom] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [error, setError] = useState<string | null>(null);

    const onDisconnectRef = useRef(onDisconnect);
    useEffect(() => {
        onDisconnectRef.current = onDisconnect;
    }, [onDisconnect]);

    const sfuUrl = (grant as any).sfuUrl as string;
    const token = grant.token;

    useEffect(() => {
        const r = new Room({
            adaptiveStream: true,
            dynacast: true,
        });

        const handleParticipantConnected = (p: Participant) => {
            setParticipants((prev) => [...prev, p]);
        };

        const handleParticipantDisconnected = (p: Participant) => {
            setParticipants((prev) => prev.filter((item) => item.sid !== p.sid));
        };

        const handleTrackSubscribed = (
            track: Track,
            publication: RemoteTrackPublication,
            participant: RemoteParticipant
        ) => {
            // Re-render tracks
            setParticipants((prev) => [...prev]);
        };

        r.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
            .on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
            .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
            .on(RoomEvent.Disconnected, () => {
                if (isAborted) {
                    console.log("[VoiceRoom] Disconnected event received during unmount/abort. Skipping onDisconnect call.");
                    return;
                }
                onDisconnectRef.current();
            });

        let isAborted = false;
        console.log("[VoiceRoom] Mounted effect, token hash:", token.slice(-10));
        async function connect() {
            try {
                console.log("[VoiceRoom] Connecting to:", sfuUrl);
                await r.connect(sfuUrl, token);
                if (isAborted) {
                    console.log("[VoiceRoom] Connection finished but component was unmounted, disconnecting");
                    void r.disconnect();
                    return;
                }
                console.log("[VoiceRoom] Connected successfully");
                setRoom(r);
                setParticipants([r.localParticipant, ...Array.from(r.remoteParticipants.values())]);
            } catch (err) {
                if (isAborted) return;
                console.error("[VoiceRoom] Failed to connect to LiveKit:", err);
                setError(err instanceof Error ? err.message : "Failed to connect to SFU");
            }
        }

        void connect();

        return () => {
            isAborted = true;
            console.log("[VoiceRoom] Cleaning up / Unmounting, was room connected?", r.state);
            void r.disconnect();
        };
    }, [sfuUrl, token]);

    useEffect(() => {
        if (!room) return;

        void room.localParticipant.setMicrophoneEnabled(!muted && !deafened);
    }, [room, muted, deafened]);

    useEffect(() => {
        if (!room) return;

        void room.localParticipant.setCameraEnabled(videoEnabled);
    }, [room, videoEnabled]);

    if (error) {
        return <div className="voice-error">{error}</div>;
    }

    return (
        <div className="voice-room">
            <div className="participants-grid">
                {participants.map((p) => (
                    <ParticipantView key={p.sid} participant={p} />
                ))}
            </div>
        </div>
    );
}

function ParticipantView({ participant }: { participant: Participant }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isSpeaking, setIsSpeaking] = useState(false);

    useEffect(() => {
        const handleMetadataChanged = () => {
            // Logic for handling metadata changes if needed
        };

        const handleIsSpeakingChanged = (speaking: boolean) => {
            setIsSpeaking(speaking);
        };

        participant.on(ParticipantEvent.IsSpeakingChanged, handleIsSpeakingChanged);

        return () => {
            participant.off(ParticipantEvent.IsSpeakingChanged, handleIsSpeakingChanged);
        };
    }, [participant]);

    // Hook up tracks
    useEffect(() => {
        const tracks = Array.from(participant.trackPublications.values());

        tracks.forEach((pub) => {
            if (pub.track) {
                if (pub.kind === Track.Kind.Video && videoRef.current) {
                    pub.track.attach(videoRef.current);
                } else if (pub.kind === Track.Kind.Audio && audioRef.current && participant instanceof RemoteParticipant) {
                    pub.track.attach(audioRef.current);
                }
            }
        });

        return () => {
            tracks.forEach((pub) => {
                if (pub.track) {
                    pub.track.detach();
                }
            });
        };
    }, [participant]);

    const videoPub = Array.from(participant.trackPublications.values()).find(
        (p) => p.kind === Track.Kind.Video
    );

    const displayLabel = participant.name || participant.identity;
    let avatarUrl: string | null = null;
    try {
        if (participant.metadata) {
            const data = JSON.parse(participant.metadata);
            avatarUrl = data.avatarUrl;
        }
    } catch (e) {
        // Ignore parse errors
    }

    const initials = (participant.name || participant.identity).slice(0, 2).toUpperCase();

    return (
        <div className={`participant-card ${isSpeaking ? "speaking" : ""}`}>
            {videoPub?.isSubscribed && videoPub.track ? (
                <video ref={videoRef} autoPlay playsInline />
            ) : (
                <div className="avatar-placeholder">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt={displayLabel} className="participant-avatar" />
                    ) : (
                        initials
                    )}
                </div>
            )}
            <audio ref={audioRef} autoPlay />
            <div className="participant-info">
                <span className="name">{displayLabel}</span>
                {participant.isMicrophoneEnabled ? null : <span className="muted-icon">🔇</span>}
            </div>
        </div>
    );
}
