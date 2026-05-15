"use client";

import React, { useState, useEffect } from "react";
import { searchUsers } from "../lib/control-plane";
import type { IdentityMapping } from "@skerry/shared";

interface UserSelectProps {
    value: IdentityMapping | null;
    onChange: (user: IdentityMapping | null) => void;
    placeholder?: string;
    style?: React.CSSProperties;
    className?: string;
}

export function UserSelect({ value, onChange, placeholder = "Search users...", style, className }: UserSelectProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<IdentityMapping[]>([]);

    useEffect(() => {
        const debounce = setTimeout(async () => {
            if (searchQuery.length >= 3 && !value) {
                try {
                    const results = await searchUsers(searchQuery);
                    setSearchResults(results);
                } catch (err) {
                    console.error("Failed to search users", err);
                }
            } else {
                setSearchResults([]);
            }
        }, 300);
        return () => clearTimeout(debounce);
    }, [searchQuery, value]);

    return (
        <div style={{ position: 'relative' }}>
            <input
                type="text"
                placeholder={placeholder}
                value={value ? value.displayName || value.oidcDisplayName || "" : searchQuery}
                onChange={(e) => {
                    setSearchQuery(e.target.value);
                    onChange(null);
                }}
                style={style}
                className={className}
            />

            {!value && searchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 10, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                    {searchResults.map(user => (
                        <div
                            key={user.productUserId}
                            onClick={() => {
                                onChange(user);
                                setSearchQuery("");
                                setSearchResults([]);
                            }}
                            style={{ padding: '0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
                            className="search-result-item"
                        >
                            {user.avatarUrl ? (
                                <img src={user.avatarUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} />
                            ) : (
                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white' }}>
                                    {(user.displayName || user.oidcDisplayName || "?").charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div>
                                <div style={{ fontWeight: 600 }}>{user.displayName || user.oidcDisplayName}</div>
                                {user.displayName && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>@{user.displayName}</div>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <style jsx>{`
                .search-result-item:hover {
                    background: var(--bg-surface-hover);
                }
            `}</style>
        </div>
    );
}
