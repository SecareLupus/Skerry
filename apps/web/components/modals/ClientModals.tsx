"use client";


import { SpaceModals } from "./SpaceModals";
import { RoomModals } from "./RoomModals";
import { CategoryModals } from "./CategoryModals";
import { InviteModals } from "./InviteModals";
import { VoiceSettingsModal } from "./VoiceSettingsModal";
import { ModerationModal } from "./ModerationModal";
import { useToast } from "../toast-provider";
import type { Server, Channel, Category, Hub, ChannelType } from "@skerry/shared";

interface ClientModalsProps {
  activeModal: string | null;
  dispatch: (action: any) => void;
  // State from ChatClient/Hooks
  spaceName: string;
  setSpaceName: (name: string) => void;
  renameSpaceId: string;
  renameSpaceName: string;
  renameSpaceIconUrl: string | null;
  spaceSettingsTab: "general" | "permissions";
  setSpaceSettingsTab: (tab: "general" | "permissions") => void;
  iconFile: File | null;
  setIconFile: (file: File | null) => void;
  
  categoryName: string;
  setCategoryName: (name: string) => void;
  renameCategoryId: string;
  renameCategoryName: string;
  
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
  roomSettingsTab: "general" | "permissions" | "preview";
  setRoomSettingsTab: (tab: "general" | "permissions" | "preview") => void;

  isInviting: boolean;
  setIsInviting: (val: boolean) => void;
  isCreatingHubInvite: boolean;
  setIsCreatingHubInvite: (val: boolean) => void;
  userSearchQuery: string;
  setUserSearchQuery: (val: string) => void;
  userSearchResults: any[];

  lastInviteUrl: string | null;
  setLastInviteUrl: (val: string | null) => void;

  mutatingStructure: boolean;
  serverId: string;
  selectedChannelId: string | null;
  selectedCategoryIdForCreate: string | null;
  selectedHubIdForCreate: string | null;
  setSelectedHubIdForCreate: (id: string | null) => void;
  hubs: Hub[];
  activeServer?: Server;
  activeChannel?: Channel;
  servers: Server[];
  channels: Channel[];
  categories: Category[];

  // Handlers
  handleCreateSpace: (e: React.FormEvent) => Promise<void>;
  handleRenameSpace: (e: React.FormEvent) => Promise<void>;
  handleCreateCategory: (e: React.FormEvent) => Promise<void>;
  handleRenameCategory: (e: React.FormEvent) => Promise<void>;
  handleDeleteCategory: (id: string) => Promise<void>;
  moveCategoryPosition: (id: string, direction: "up" | "down") => Promise<void>;
  handleCreateRoom: (e: React.FormEvent) => Promise<void>;
  handleRenameRoom: (e: React.FormEvent) => Promise<void>;
  moveChannelPosition: (id: string, direction: "up" | "down") => Promise<void>;
  performDeleteRoom: (serverId: string, roomId: string) => Promise<void>;
  refreshChatState: (serverId?: string, channelId?: string, messageId?: string, force?: boolean) => Promise<void>;
  
  // Moderation state
  moderationTargetUserId: string | null;
  moderationTargetDisplayName: string | null;
}

export function ClientModals(props: ClientModalsProps) {
  const { activeModal, dispatch, renameRoomType } = props;
  const { showToast } = useToast();

  const isClientControlled = activeModal === "create-space" ||
    activeModal === "rename-space" ||
    activeModal === "create-category" ||
    activeModal === "rename-category" ||
    activeModal === "create-room" ||
    activeModal === "rename-room" ||
    activeModal === "moderation";

  // Modals beyond `isClientControlled` (e.g. VoiceSettingsModal) self-mount
  // their own backdrop/panel below. Only short-circuit when there's literally
  // nothing to show — otherwise self-rendering modals never get a chance.
  if (!activeModal && !props.isInviting && !props.isCreatingHubInvite) return null;

  return (
    <>
      {isClientControlled && activeModal && (
        <div className="modal-backdrop" data-testid="modal-backdrop" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
          <div 
            className={`modal-panel ${activeModal === "rename-room" && renameRoomType === "landing" ? "wide-layout" : ""}`} 
            onClick={(e) => e.stopPropagation()}
            style={activeModal === "rename-room" && renameRoomType === "landing" ? { width: 'min(1600px, 95vw)', maxWidth: 'none' } : {}}
          >
            <header className="modal-header" style={(activeModal === "rename-room" && renameRoomType === "landing") ? { padding: '1.5rem 1.5rem 0.75rem' } : {}}>
              <h2>
                {activeModal === "create-space" && "Create a New Space"}
                {activeModal === "rename-space" && "Space Settings"}
                {activeModal === "create-category" && "Create Category"}
                {activeModal === "rename-category" && "Category Settings"}
                {activeModal === "create-room" && "Create Room"}
                {activeModal === "rename-room" && (renameRoomType === "landing" ? "Creator Suite" : "Room Settings")}
                {activeModal === "moderation" && "Moderate User"}
              </h2>
              <button 
                type="button" 
                className="ghost" 
                onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}
                style={{ borderRadius: '50%', padding: '0.5rem', width: '32px', height: '32px', minWidth: '32px' }}
              >
                &times;
              </button>
            </header>

            <SpaceModals 
              activeModal={activeModal}
              spaceSettingsTab={props.spaceSettingsTab}
              setSpaceSettingsTab={props.setSpaceSettingsTab}
              spaceName={props.spaceName}
              setSpaceName={props.setSpaceName}
              renameSpaceId={props.renameSpaceId}
              renameSpaceName={props.renameSpaceName}
              renameSpaceIconUrl={props.renameSpaceIconUrl}
              iconFile={props.iconFile}
              setIconFile={props.setIconFile}
              mutatingStructure={props.mutatingStructure}
              servers={props.servers}
              activeServer={props.activeServer}
              handleCreateSpace={props.handleCreateSpace}
              handleRenameSpace={props.handleRenameSpace}
              dispatch={dispatch}
              showToast={showToast}
              refreshChatState={props.refreshChatState}
            />

            <CategoryModals 
              activeModal={activeModal}
              categoryName={props.categoryName}
              setCategoryName={props.setCategoryName}
              renameCategoryId={props.renameCategoryId}
              renameCategoryName={props.renameCategoryName}
              categories={props.categories}
              mutatingStructure={props.mutatingStructure}
              handleCreateCategory={props.handleCreateCategory}
              handleRenameCategory={props.handleRenameCategory}
              handleDeleteCategory={props.handleDeleteCategory}
              moveCategoryPosition={props.moveCategoryPosition}
              dispatch={dispatch}
              showToast={showToast}
            />

            <RoomModals 
              activeModal={activeModal}
              roomSettingsTab={props.roomSettingsTab}
              setRoomSettingsTab={props.setRoomSettingsTab}
              roomName={props.roomName}
              setRoomName={props.setRoomName}
              roomType={props.roomType}
              setRoomType={props.setRoomType}
              roomIcon={props.roomIcon}
              setRoomIcon={props.setRoomIcon}
              renameRoomId={props.renameRoomId}
              renameRoomName={props.renameRoomName}
              renameRoomType={props.renameRoomType}
              renameRoomCategoryId={props.renameRoomCategoryId}
              renameRoomTopic={props.renameRoomTopic}
              renameRoomIconUrl={props.renameRoomIconUrl}
              renameRoomStyleContent={props.renameRoomStyleContent}
              mutatingStructure={props.mutatingStructure}
              serverId={props.serverId}
              selectedCategoryIdForCreate={props.selectedCategoryIdForCreate}
              channels={props.channels}
              categories={props.categories}
              activeChannel={props.activeChannel}
              handleCreateRoom={props.handleCreateRoom}
              handleRenameRoom={props.handleRenameRoom}
              moveChannelPosition={props.moveChannelPosition}
              performDeleteRoom={props.performDeleteRoom}
              dispatch={dispatch}
              showToast={showToast}
              refreshChatState={props.refreshChatState}
            />

            {activeModal === "moderation" && props.moderationTargetUserId && (
              <ModerationModal
                targetUserId={props.moderationTargetUserId}
                targetDisplayName={props.moderationTargetDisplayName || "User"}
                serverId={props.serverId}
                hubId={props.activeServer?.hubId}
                onClose={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}
                showToast={showToast}
                refreshChatState={() => props.refreshChatState(undefined, undefined, undefined, true)}
              />
            )}
          </div>
        </div>
      )}

      <InviteModals 
        isInviting={props.isInviting}
        setIsInviting={props.setIsInviting}
        isCreatingHubInvite={props.isCreatingHubInvite}
        setIsCreatingHubInvite={props.setIsCreatingHubInvite}
        userSearchQuery={props.userSearchQuery}
        setUserSearchQuery={props.setUserSearchQuery}
        userSearchResults={props.userSearchResults}
        activeServer={props.activeServer}
        selectedChannelId={props.selectedChannelId}
        lastInviteUrl={props.lastInviteUrl}
        setLastInviteUrl={props.setLastInviteUrl}
        showToast={showToast}
      />

      <VoiceSettingsModal 
        activeModal={activeModal}
        onClose={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}
      />
    </>
  );
}
