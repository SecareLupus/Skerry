"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  listServerEmojis,
  createServerEmoji,
  deleteServerEmoji,
  listDiscordEmojis,
  pullAllDiscordEmojis,
  uploadMedia
} from "../../../../../lib/control-plane";
import { useChat } from "../../../../../context/chat-context";
import { useToast } from "../../../../../components/toast-provider";
import type { ServerEmoji, DiscordGuildEmoji } from "@skerry/shared";

export default function SpaceEmojisPage() {
  const params = useParams();
  const serverId = params.id as string;
  const { state } = useChat();
  const { servers } = state;
  const { showToast } = useToast();

  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [discordEmojis, setDiscordEmojis] = useState<DiscordGuildEmoji[]>([]);
  const [discordMessage, setDiscordMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const server = servers.find(s => s.id === serverId);

  const loadEmojis = useCallback(async () => {
    if (!serverId) return;
    try {
      const { items } = await listServerEmojis(serverId);
      setEmojis(items);
    } catch (err) {
      console.error("Failed to load emojis", err);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  const loadDiscordEmojis = useCallback(async () => {
    if (!serverId) return;
    setDiscordLoading(true);
    try {
      const { items, message } = await listDiscordEmojis(serverId);
      setDiscordEmojis(items);
      setDiscordMessage(message ?? null);
    } catch (err) {
      console.error("Failed to load Discord emojis", err);
    } finally {
      setDiscordLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadEmojis();
    void loadDiscordEmojis();
  }, [loadEmojis, loadDiscordEmojis]);

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string).trim();
    const file = formData.get("file") as File;

    if (!name || !file) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      showToast("Emoji name must be alphanumeric with underscores/hyphens", "error");
      return;
    }

    setUploading(true);
    try {
      const upload = await uploadMedia(serverId, file);
      await createServerEmoji(serverId, name, upload.url);
      showToast("Emoji added", "success");
      setShowCreate(false);
      (e.target as HTMLFormElement).reset();
      await loadEmojis();
    } catch (err) {
      showToast("Failed to upload emoji", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (emojiId: string, name: string) => {
    if (!confirm(`Delete emoji ":${name}:"? This cannot be undone.`)) return;
    try {
      await deleteServerEmoji(serverId, emojiId);
      setEmojis(prev => prev.filter(e => e.id !== emojiId));
      showToast("Emoji deleted", "success");
    } catch (err) {
      showToast("Failed to delete emoji", "error");
    }
  };

  const handlePullAll = async () => {
    const unmirroredCount = discordEmojis.filter(e => !e.isMirrored).length;
    if (unmirroredCount === 0) {
      showToast("All Discord emojis are already pulled", "success");
      return;
    }

    if (!confirm(`Pull ${unmirroredCount} Discord emoji(s) into this space?`)) return;

    setPulling(true);
    try {
      const result = await pullAllDiscordEmojis(serverId);
      showToast(`Pulled ${result.pulled} emojis (${result.skipped} skipped)`, "success");
      await loadEmojis();
      await loadDiscordEmojis();
    } catch (err) {
      showToast("Failed to pull Discord emojis", "error");
    } finally {
      setPulling(false);
    }
  };

  if (loading) return <p>Loading emojis...</p>;

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Custom Emojis</h2>
          <p className="settings-description">
            Manage custom emojis for {server?.name ?? "this space"}.
            These emojis are scoped to this space and can be used in messages and reactions.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          Upload Emoji
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleUpload}
          className="settings-grid"
          style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid var(--border)', borderRadius: '8px' }}
        >
          <h3>Add Emoji</h3>
          <section className="settings-row">
            <label htmlFor="emoji-name">Name</label>
            <input
              id="emoji-name"
              name="name"
              className="filter-input"
              required
              placeholder="e.g. pogchamp, kekw"
              maxLength={32}
              pattern="[a-zA-Z0-9_-]+"
              title="Alphanumeric with underscores and hyphens only"
            />
            <p className="settings-description">Use :name: in messages to insert this emoji.</p>
          </section>
          <section className="settings-row">
            <label htmlFor="emoji-file">Image</label>
            <input
              id="emoji-file"
              name="file"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              required
              className="filter-input"
            />
            <p className="settings-description">PNG, JPEG, GIF, or WebP. Recommended: 128x128px.</p>
          </section>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="submit" className="btn-primary" disabled={uploading}>
              {uploading ? "Uploading..." : "Add Emoji"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Native emoji list */}
      <div style={{ marginTop: '2rem' }}>
        <h3>Space Emojis ({emojis.length})</h3>
        {emojis.length === 0 ? (
          <p className="settings-description">No custom emojis yet. Upload one above, or pull from Discord below.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
            {emojis.map(emoji => (
              <div
                key={emoji.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.75rem',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--panel-bg-lighter)',
                  position: 'relative'
                }}
              >
                <img
                  src={emoji.url}
                  alt={`:${emoji.name}:`}
                  style={{ width: '48px', height: '48px', objectFit: 'contain' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', wordBreak: 'break-all' }}>
                  :{emoji.name}:
                </span>
                <button
                  className="btn-danger btn-small"
                  onClick={() => handleDelete(emoji.id, emoji.name)}
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}
                  title={`Delete :${emoji.name}:`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <hr style={{ margin: '3rem 0', border: 'none', borderTop: '1px solid var(--border)' }} />

      {/* Discord emoji section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Discord Emojis</h3>
          <button
            className="btn-secondary"
            onClick={handlePullAll}
            disabled={pulling || discordEmojis.length === 0}
          >
            {pulling ? "Pulling..." : `Pull All (${discordEmojis.filter(e => !e.isMirrored).length})`}
          </button>
        </div>
        <p className="settings-description">
          Emojis available from the connected Discord guild. Already-pulled emojis are marked.
        </p>

        {discordLoading ? (
          <p>Loading Discord emojis...</p>
        ) : discordMessage ? (
          <div className="alert-box warning" style={{ marginTop: '1rem' }}>
            <p>{discordMessage}</p>
          </div>
        ) : discordEmojis.length === 0 ? (
          <p className="settings-description" style={{ marginTop: '1rem' }}>No Discord emojis available.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
            {discordEmojis.map(emoji => (
              <div
                key={emoji.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.75rem',
                  border: `2px solid ${emoji.isMirrored ? 'var(--success)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  backgroundColor: 'var(--panel-bg-lighter)',
                  opacity: emoji.isMirrored ? 0.6 : 1
                }}
              >
                <img
                  src={emoji.url}
                  alt={`:${emoji.name}:`}
                  style={{ width: '48px', height: '48px', objectFit: 'contain' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', wordBreak: 'break-all' }}>
                  :{emoji.name}:
                </span>
                {emoji.isMirrored ? (
                  <span style={{ fontSize: '0.65rem', color: 'var(--success)' }}>Pulled ✓</span>
                ) : (
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Not pulled</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
