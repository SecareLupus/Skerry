"use client";

import React from "react";
import { useChat } from "../context/chat-context";
import { ProfileModal } from "./profile-modal";
import { ModerationModal } from "./moderation-modal";
import { DMPickerModal } from "./dm-picker-modal";
import { SearchModal } from "./search-modal";
import { RoleModal } from "./role-modal";
import { MasqueradeDrawer } from "./masquerade-drawer";
import { ConfirmationModal } from "./confirmation-modal";

export function ModalManager() {
  const { state } = useChat();
  const { activeModal } = state;

  return (
    <>
      {activeModal === "profile" && <ProfileModal />}
      {activeModal === "moderation" && <ModerationModal />}
      {activeModal === "dm-picker" && <DMPickerModal />}
      {activeModal === "search" && <SearchModal />}
      {activeModal === "grant-role" && <RoleModal />}
      {activeModal === "masquerade" && <MasqueradeDrawer />}
    </>
  );
}
