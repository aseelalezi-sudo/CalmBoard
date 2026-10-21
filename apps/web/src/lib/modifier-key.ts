import { useEffect, useState } from "react";

export function modifierKeyLabel(platform: string) {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}

// Starts as "Ctrl" so server and first client render match, then switches to ⌘ on Apple platforms.
export function useModifierKeyLabel() {
  const [label, setLabel] = useState("Ctrl");
  useEffect(() => {
    setLabel(modifierKeyLabel(navigator.platform || navigator.userAgent));
  }, []);
  return label;
}
