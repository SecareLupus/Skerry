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
    screenShareEnabled: boolean;
    onDisconnect: () => void;
}

export function VoiceRoom({ grant, muted, deafened, videoEnabled, screenShareEnabled, onDisconnect }: VoiceRoomProps) {
    const [room, setRoom] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [focusedTrackSid, setFocusedTrackSid] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onDisconnectRef = useRef(onDisconnect);
    useEffect(() => {
        onDisconnectRef.current = onDisconnect;
    }, [onDisconnect]);

    const sfuUrl = grant.sfuUrl;
    const token = grant.token;

    useEffect(() => {
        const videoDeviceId = localStorage.getItem("skerry_video_device") || undefined;
        const audioInDeviceId = localStorage.getItem("skerry_audio_in_device") || undefined;
        const audioOutDeviceId = localStorage.getItem("skerry_audio_out_device") || undefined;

        const r = new Room({
            adaptiveStream: true,
            dynacast: true,
            videoCaptureDefaults: {
                deviceId: videoDeviceId,
            },
            audioCaptureDefaults: {
                deviceId: audioInDeviceId,
            },
        });

        if (audioOutDeviceId) {
            void r.switchActiveDevice('audiooutput', audioOutDeviceId);
        }

        let isAborted = false;

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
            setParticipants((prev) => [...prev]);
        };

        const handleLocalTrackPublished = (
            publication: LocalTrackPublication,
            participant: LocalParticipant
        ) => {
             setParticipants((prev) => [...prev]);
             if (publication.source === Track.Source.ScreenShare) {
                 setFocusedTrackSid(publication.trackSid);
             }
        };

        const handleTrackPublished = (
            publication: RemoteTrackPublication,
            participant: RemoteParticipant
        ) => {
             setParticipants((prev) => [...prev]);
             if (publication.source === Track.Source.ScreenShare) {
                setFocusedTrackSid(publication.trackSid);
            }
        };

        r.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
            .on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
            .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
            .on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished)
            .on(RoomEvent.TrackPublished, handleTrackPublished)
            .on(RoomEvent.LocalTrackUnpublished, () => setParticipants((prev) => [...prev]))
            .on(RoomEvent.TrackUnpublished, () => setParticipants((prev) => [...prev]))
            .on(RoomEvent.Disconnected, () => {
                if (isAborted) return;
                onDisconnectRef.current();
            });

        async function connect() {
            try {
                await r.connect(sfuUrl, token);
                if (isAborted) {
                    void r.disconnect();
                    return;
                }
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

    useEffect(() => {
        if (!room) return;
        void room.localParticipant.setScreenShareEnabled(screenShareEnabled, { audio: true });
    }, [room, screenShareEnabled]);

    const allVideoPubs = participants.flatMap((p) => 
        Array.from(p.trackPublications.values()).filter(pub => pub.kind === Track.Kind.Video)
    );

    const getParticipantForPub = (pub: TrackPublication) => {
        return participants.find(p => Array.from(p.trackPublications.values()).includes(pub));
    };

    const focusedPub = allVideoPubs.find(pub => pub.trackSid === focusedTrackSid);
    const sidebarPubs = allVideoPubs.filter(pub => pub.trackSid !== focusedTrackSid);

    const toggleFocus = (sid: string) => {
        setFocusedTrackSid(prev => prev === sid ? null : sid);
    };

    if (error) {
        return <div className="voice-error" data-testid="voice-error">{error}</div>;
    }

    return (
        <div className={`voice-room ${focusedTrackSid ? "stage-mode" : ""}`}>
            {focusedTrackSid && focusedPub ? (
                <div className="participants-stage">
                    <div className="hero-container">
                        <ParticipantView 
                            key={focusedPub.trackSid} 
                            participant={getParticipantForPub(focusedPub)!} 
                            publication={focusedPub}
                            isFocused={true}
                            onToggleFocus={toggleFocus}
                        />
                    </div>
                    {sidebarPubs.length > 0 && (
                        <div className="sidebar-container">
                            {sidebarPubs.map((pub) => (
                                <ParticipantView 
                                    key={pub.trackSid} 
                                    participant={getParticipantForPub(pub)!} 
                                    publication={pub}
                                    isFocused={false}
                                    onToggleFocus={toggleFocus}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="participants-grid">
                    {allVideoPubs.length > 0 ? (
                        allVideoPubs.map((pub) => (
                            <ParticipantView 
                                key={pub.trackSid} 
                                participant={getParticipantForPub(pub)!} 
                                publication={pub}
                                isFocused={false}
                                onToggleFocus={toggleFocus}
                            />
                        ))
                    ) : (
                        participants.map((p) => (
                            <ParticipantView 
                                key={p.sid} 
                                participant={p} 
                                isFocused={false}
                                onToggleFocus={toggleFocus}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

interface ParticipantViewProps {
    participant: Participant;
    publication?: TrackPublication;
    isFocused: boolean;
    onToggleFocus: (sid: string) => void;
}

function ParticipantView({ participant, publication, isFocused, onToggleFocus }: ParticipantViewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [updateCount, setUpdateCount] = useState(0);

    const handlePiP = async () => {
        if (!videoRef.current) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await videoRef.current.requestPictureInPicture();
            }
        } catch (e) {
            console.error("PiP failed", e);
        }
    };

    useEffect(() => {
        const handleIsSpeakingChanged = (speaking: boolean) => {
            setIsSpeaking(speaking);
        };

        const triggerUpdate = () => {
            setUpdateCount((c) => c + 1);
        };

        participant.on(ParticipantEvent.IsSpeakingChanged, handleIsSpeakingChanged)
                   .on(ParticipantEvent.TrackSubscribed, triggerUpdate)
                   .on(ParticipantEvent.TrackUnsubscribed, triggerUpdate)
                   .on(ParticipantEvent.TrackPublished, triggerUpdate)
                   .on(ParticipantEvent.TrackUnpublished, triggerUpdate)
                   .on(ParticipantEvent.LocalTrackPublished, triggerUpdate)
                   .on(ParticipantEvent.LocalTrackUnpublished, triggerUpdate)
                   .on(ParticipantEvent.TrackMuted, triggerUpdate)
                   .on(ParticipantEvent.TrackUnmuted, triggerUpdate);

        return () => {
            participant.off(ParticipantEvent.IsSpeakingChanged, handleIsSpeakingChanged)
                       .off(ParticipantEvent.TrackSubscribed, triggerUpdate)
                       .off(ParticipantEvent.TrackUnsubscribed, triggerUpdate)
                       .off(ParticipantEvent.TrackPublished, triggerUpdate)
                       .off(ParticipantEvent.TrackUnpublished, triggerUpdate)
                       .off(ParticipantEvent.LocalTrackPublished, triggerUpdate)
                       .off(ParticipantEvent.LocalTrackUnpublished, triggerUpdate)
                       .off(ParticipantEvent.TrackMuted, triggerUpdate)
                       .off(ParticipantEvent.TrackUnmuted, triggerUpdate);
        };
    }, [participant]);

    useEffect(() => {
        const videoElement = videoRef.current;
        const audioElement = audioRef.current;

        if (publication?.track) {
            if (publication.kind === Track.Kind.Video && videoElement) {
                publication.track.attach(videoElement);
            }
        }

        if (participant instanceof RemoteParticipant) {
             const audioPub = Array.from(participant.trackPublications.values()).find(p => p.kind === Track.Kind.Audio);
             if (audioPub?.track && audioElement) {
                 audioPub.track.attach(audioElement);
             }
        }

        return () => {
            if (publication?.track) {
                if (videoElement) publication.track.detach(videoElement);
            }
            if (participant instanceof RemoteParticipant && audioElement) {
                 const audioPub = Array.from(participant.trackPublications.values()).find(p => p.kind === Track.Kind.Audio);
                 if (audioPub?.track) audioPub.track.detach(audioElement);
            }
        };
    }, [participant, publication, updateCount]);

    const videoPub = publication || Array.from(participant.trackPublications.values()).find(
        (p) => p.kind === Track.Kind.Video
    );
    const cameraPublished = videoPub && (videoPub instanceof LocalTrackPublication || videoPub.isSubscribed);
    const cameraMuted = videoPub?.isMuted;

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
        <div className={`participant-card ${isSpeaking ? "speaking" : ""} ${isFocused ? "focused" : ""}`}>
            {cameraPublished && videoPub?.track && !cameraMuted ? (
                <video ref={videoRef} autoPlay playsInline muted={participant instanceof LocalParticipant} />
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
                <div className="name-area">
                    <span className="name">{displayLabel}</span>
                    {videoPub && <span className="source-tag">{videoPub.source === Track.Source.ScreenShare ? "Screen" : "Camera"}</span>}
                    {participant.isMicrophoneEnabled ? null : <span className="muted-icon">🔇</span>}
                </div>
                <div className="card-actions">
                    {videoPub && (
                        <>
                            <button title="Toggle Focus" onClick={() => onToggleFocus(videoPub.trackSid)}>
                                {isFocused ? "🔎" : "🎯"}
                            </button>
                            <button title="Pop out (PiP)" onClick={handlePiP}>
                                🔲
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
