"use client";

import React, { useMemo, useRef, useEffect, useState } from "react";
import DOMPurify from "dompurify";
import ReactDOM from "react-dom";
import { LandingJoinButton } from "./landing-join-button";
import type { Channel } from "@skerry/shared";

interface LandingPageViewProps {
    channel?: Channel;
    topic?: string | null;
    styleContent?: string | null;
    serverId?: string;
}

function JoinButtonPortal({ target, serverId }: { target: HTMLElement, serverId: string }) {
    return ReactDOM.createPortal(
        <LandingJoinButton serverId={serverId} />,
        target
    );
}

export function LandingPageView({ channel, topic, styleContent, serverId }: LandingPageViewProps) {
    const activeTopic = topic !== undefined ? topic : channel?.topic;
    const activeStyle = styleContent !== undefined ? styleContent : channel?.styleContent;
    const activeServerId = serverId || channel?.serverId || "";

    const html = useMemo(() => {
        if (!activeTopic) return "<div style='display:flex; align-items:center; justify-content:center; height:100%; opacity:0.6;'>No content configured for this landing page. Use 'Edit Room' to add HTML and CSS.</div>";
        return DOMPurify.sanitize(activeTopic, {
            ALLOWED_TAGS: ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'b', 'i', 'strong', 'em', 'img', 'style', 'section', 'article', 'skerry-join-button'],
            ALLOWED_ATTR: ['class', 'id', 'style', 'src', 'href', 'target'],
            ADD_TAGS: ['skerry-join-button']
        });
    }, [activeTopic]);

    const containerRef = useRef<HTMLDivElement>(null);
    const [portalTargets, setPortalTargets] = useState<HTMLElement[]>([]);

    useEffect(() => {
        if (containerRef.current) {
            const targets = Array.from(containerRef.current.querySelectorAll('skerry-join-button')) as HTMLElement[];
            setPortalTargets(targets);
        }
    }, [html]);

    return (
        <div className="landing-page-container" ref={containerRef} style={{ height: '100%', overflowY: 'auto' }}>
            <div 
                className="landing-html-renderer"
                dangerouslySetInnerHTML={{ __html: html }} 
            />
            {activeStyle && (
                <style dangerouslySetInnerHTML={{ __html: activeStyle }} />
            )}
            {portalTargets.map((target, idx) => (
                <JoinButtonPortal key={idx} target={target} serverId={activeServerId} />
            ))}
        </div>
    );
}
