"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  AtSign,
  Award,
  Ban,
  Bell,
  Camera,
  Clipboard,
  Headphones,
  Home,
  Hourglass,
  Link,
  Lock,
  Menu,
  MessageSquare,
  MessageSquareDot,
  Mic,
  MicOff,
  Moon,
  Paperclip,
  PenLine,
  PhoneOff,
  Pin,
  Plus,
  Reply,
  ScrollText,
  Search,
  Settings,
  Shield,
  SmilePlus,
  Sun,
  Trash2,
  User,
  Users,
  Video,
  Volume1,
  Pencil,
  X,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  "alert-triangle": AlertTriangle,
  "arrow-left": ArrowLeft,
  "at-sign": AtSign,
  award: Award,
  ban: Ban,
  bell: Bell,
  camera: Camera,
  clipboard: Clipboard,
  headphones: Headphones,
  home: Home,
  hourglass: Hourglass,
  link: Link,
  lock: Lock,
  menu: Menu,
  "message-square": MessageSquare,
  "message-square-dot": MessageSquareDot,
  mic: Mic,
  "mic-off": MicOff,
  moon: Moon,
  paperclip: Paperclip,
  "pen-line": PenLine,
  "phone-off": PhoneOff,
  pin: Pin,
  plus: Plus,
  reply: Reply,
  "scroll-text": ScrollText,
  search: Search,
  settings: Settings,
  shield: Shield,
  "smile-plus": SmilePlus,
  sun: Sun,
  "trash-2": Trash2,
  user: User,
  users: Users,
  video: Video,
  "volume-1": Volume1,
  pencil: Pencil,
  x: X,
};

export type IconName = keyof typeof iconMap;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  "aria-label"?: string;
  strokeWidth?: number;
}

export default function Icon({
  name,
  size = 18,
  className,
  "aria-label": ariaLabel,
  strokeWidth = 2,
}: IconProps) {
  const LucideComponent = iconMap[name];
  if (!LucideComponent) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }
  return (
    <LucideComponent
      size={size}
      className={className}
      aria-label={ariaLabel}
      strokeWidth={strokeWidth}
    />
  );
}
