"use client";

import React, { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label?: string;
  icon?: string;
  onClick?: () => void;
  danger?: boolean;
  type?: "item" | "header" | "separator";
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  // Adjust position if menu goes off screen
  const style: React.CSSProperties = {
    top: y,
    left: x,
  };

  if (menuRef.current) {
    const rect = menuRef.current.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
      style.left = x - rect.width;
    }
    if (y + rect.height > window.innerHeight) {
      style.top = y - rect.height;
    }
  }

  return (
    <div className="context-menu" ref={menuRef} style={style}>
      {items.map((item, index) => {
        if (item.type === "header") {
          return (
            <div key={index} className="context-menu-header">
              {item.label}
            </div>
          );
        }
        if (item.type === "separator") {
          return <div key={index} className="context-menu-separator" />;
        }
        return (
          <button
            key={index}
            className={`context-menu-item ${item.danger ? "danger" : ""}`}
            data-testid={`context-menu-item-${item.label?.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          >
            {item.icon && <span>{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
