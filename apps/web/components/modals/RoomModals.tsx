"use client";

import { IconPicker } from "../icon-picker";
import { CreatorSuite } from "../creator-suite/CreatorSuite";
import { PermissionsEditor } from "../permissions-editor";
import { updateChannelSettings } from "../../lib/control-plane";
import { getChannelIcon } from "../../lib/channel-utils";
import type { Channel, Category, ChannelType } from "@skerry/shared";

const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" ");

interface RoomModalsProps {
  activeModal: string | null;
  roomSettingsTab: "general" | "permissions" | "preview";
  setRoomSettingsTab: (tab: "general" | "permissions" | "preview") => void;
  roomName: string;
  setRoomName: (name: string) => void;
  roomType: ChannelType;
  setRoomType: (type: ChannelType) => void;
  roomIcon: string | null;
  setRoomIcon: (icon: string) => void;
  renameRoomId: string;
  renameRoomName: string;
  renameRoomType: ChannelType;
  renameRoomCategoryId: string | null;
  renameRoomTopic: string;
  renameRoomIconUrl: string | null;
  renameRoomStyleContent: string | null;
  mutatingStructure: boolean;
  serverId: string;
  selectedCategoryIdForCreate: string | null;
  channels: Channel[];
  categories: Category[];
  activeChannel?: Channel;
  handleCreateRoom: (e: React.FormEvent) => Promise<void>;
  handleRenameRoom: (e: React.FormEvent) => Promise<void>;
  moveChannelPosition: (id: string, direction: "up" | "down") => Promise<void>;
  performDeleteRoom: (serverId: string, roomId: string) => Promise<void>;
  dispatch: (action: any) => void;
  showToast: (message: string, type: "success" | "error") => void;
  refreshChatState: (serverId?: string, channelId?: string, messageId?: string, force?: boolean) => Promise<void>;
}

export function RoomModals({
  activeModal,
  roomSettingsTab,
  setRoomSettingsTab,
  roomName,
  setRoomName,
  roomType,
  setRoomType,
  roomIcon,
  setRoomIcon,
  renameRoomId,
  renameRoomName,
  renameRoomType,
  renameRoomCategoryId,
  renameRoomTopic,
  renameRoomIconUrl,
  renameRoomStyleContent,
  mutatingStructure,
  serverId,
  selectedCategoryIdForCreate,
  channels,
  categories,
  activeChannel,
  handleCreateRoom,
  handleRenameRoom,
  moveChannelPosition,
  performDeleteRoom,
  dispatch,
  showToast,
  refreshChatState
}: RoomModalsProps) {
  if (activeModal === "create-room") {
    return (
      <form className="constrained-stack" onSubmit={(event) => {
        void handleCreateRoom(event);
        dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      }}>
        <p>
          Target Category: <strong>
            {selectedCategoryIdForCreate ? categories.find(c => c.id === selectedCategoryIdForCreate)?.name : "Uncategorized"}
          </strong>
        </p>
        <label htmlFor="room-name-modal">Room Name</label>
        <input
          id="room-name-modal"
          autoFocus
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          minLength={2}
          maxLength={80}
          required
        />
        <label htmlFor="room-type-modal">Type</label>
        <select id="room-type-modal" value={roomType} onChange={(e) => setRoomType(e.target.value as any)}>
          <option value="text">Text Room</option>
          <option value="announcement">Announcement Room</option>
          <option value="forum">Forum Room</option>
          <option value="voice">Voice Room</option>
          <option value="landing">Landing Page</option>
        </select>

        <label>Room Icon</label>
        <IconPicker 
          value={roomIcon || ""} 
          onChange={setRoomIcon} 
          defaultIcon={getChannelIcon({ type: roomType } as Channel)}
        />

        <button type="submit" disabled={mutatingStructure}>Create Room</button>
      </form>
    );
  }

  if (activeModal === "rename-room") {
    if (renameRoomType === "landing") {
      return (
        <CreatorSuite 
          serverId={serverId}
          channels={channels}
          renameRoomId={renameRoomId}
          renameRoomName={renameRoomName}
          renameRoomType={renameRoomType}
          renameRoomCategoryId={renameRoomCategoryId}
          renameRoomTopic={renameRoomTopic}
          renameRoomIconUrl={renameRoomIconUrl}
          renameRoomStyleContent={renameRoomStyleContent}
          dispatch={dispatch}
          handleRenameRoom={handleRenameRoom}
          moveChannelPosition={moveChannelPosition}
          performDeleteRoom={performDeleteRoom}
          mutatingStructure={mutatingStructure}
        />
      );
    }

    return (
      <div className="stack">
        <div className="tabs">
          <button 
            className={cn("tab-button", roomSettingsTab === "general" && "active")}
            onClick={() => setRoomSettingsTab("general")}
          >
            General
          </button>
          <button 
            className={cn("tab-button", roomSettingsTab === "permissions" && "active")}
            onClick={() => setRoomSettingsTab("permissions")}
          >
            Permissions
          </button>
        </div>

        {roomSettingsTab === "general" ? (
          <div className="constrained-stack">
            <form className="constrained-stack" style={{ width: '100%' }} onSubmit={handleRenameRoom}>
              <p>Editing Room: <strong>{channels.find(c => c.id === renameRoomId)?.name}</strong></p>
              <label htmlFor="rename-room-modal">Room Name</label>
              <input
                id="rename-room-modal"
                autoFocus
                value={renameRoomName}
                onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: e.target.value, type: renameRoomType } })}
                minLength={2}
                maxLength={80}
                required
              />

              <label>Room Icon</label>
              <IconPicker 
                value={renameRoomIconUrl || ""} 
                onChange={(val) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, iconUrl: val } })} 
                defaultIcon={getChannelIcon({ type: renameRoomType } as Channel)}
              />

              <label htmlFor="rename-room-topic">Room Topic</label>
              <input
                id="rename-room-topic"
                value={renameRoomTopic}
                onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, topic: e.target.value } })}
                maxLength={255}
                placeholder="Set a topic for this room..."
              />

              <label htmlFor="rename-room-type">Type</label>
              <select
                id="rename-room-type"
                value={renameRoomType}
                onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, type: e.target.value as any } })}
              >
                <option value="text">Text Room</option>
                <option value="announcement">Announcement Room</option>
                <option value="forum">Forum Room</option>
                <option value="voice">Voice Room</option>
                <option value="landing">Landing Page</option>
              </select>

              <label htmlFor="rename-room-category">Category</label>
              <select
                id="rename-room-category"
                value={renameRoomCategoryId || ""}
                onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, categoryId: e.target.value || null } })}
              >
                <option value="">No Category</option>
                {categories
                  .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
              </select>

              <button type="submit" disabled={mutatingStructure}>Save Changes</button>
            </form>

            <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", width: '100%' }}>
              <p>Reorder Room</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  disabled={mutatingStructure}
                  onClick={() => moveChannelPosition(renameRoomId, "up")}
                >
                  Move Up
                </button>
                <button
                  type="button"
                  disabled={mutatingStructure}
                  onClick={() => moveChannelPosition(renameRoomId, "down")}
                >
                  Move Down
                </button>
              </div>
            </div>

            <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", width: '100%' }}>
              <p>Danger Zone</p>
              <button
                type="button"
                className="danger"
                disabled={mutatingStructure}
                onClick={() => {
                  if (confirm(`Are you sure you want to delete the room "${renameRoomName}"? All messages and content will be lost.`)) {
                    void performDeleteRoom(serverId, renameRoomId);
                    dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                  }
                }}
              >
                Delete Room
              </button>
            </div>
          </div>
        ) : (() => {
          const channelToEdit = channels.find(c => c.id === renameRoomId) || activeChannel;
          return (
            <PermissionsEditor 
              serverId={channelToEdit?.serverId ?? serverId}
              channelId={renameRoomId}
              initialAccess={{
                hubAdminAccess: channelToEdit?.hubAdminAccess ?? 'chat',
                spaceMemberAccess: channelToEdit?.spaceMemberAccess ?? 'chat',
                hubMemberAccess: channelToEdit?.hubMemberAccess ?? 'chat',
                visitorAccess: channelToEdit?.visitorAccess ?? 'hidden'
              }}
              onSaveDefaults={async (access) => {
                await updateChannelSettings(renameRoomId, {
                  serverId: channelToEdit?.serverId ?? serverId ?? "",
                  ...access
                });
                showToast("Permissions updated", "success");
                void refreshChatState(undefined, undefined, undefined, true);
              }}
            />
          );
        })()}
      </div>
    );
  }

  return null;
}
