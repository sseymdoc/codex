import { useState, useSyncExternalStore } from "react";
import { externalUrl } from "../lib/format";
import { Icon } from "./ui";

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
const subscribeTheme = (changed: () => void) => {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
};

/** Whether the dark theme is on (the html element's class), following changes. */
export const useDarkTheme = () => useSyncExternalStore(subscribeTheme, isDark, isDark);

/** App metadata provides public image URLs; a failed image must not leave a broken-image glyph. */
export function ConnectorIcon({ light, dark, size = 18 }: { light?: string | null; dark?: string | null; size?: number }) {
  const darkMode = useDarkTheme();
  const lightUrl = light ? externalUrl(light) : null;
  const darkUrl = dark ? externalUrl(dark) : null;
  const src = darkMode ? (darkUrl ?? lightUrl) : (lightUrl ?? darkUrl);
  return <ConnectorImage key={src} src={src} size={size} />;
}

function ConnectorImage({ src, size }: { src: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img className="mention-icon" src={src} alt="" referrerPolicy="no-referrer" style={{ objectFit: "contain" }} onError={() => setFailed(true)} />
  ) : (
    <Icon name="Connectors" size={size} />
  );
}
