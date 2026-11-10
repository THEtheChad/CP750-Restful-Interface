import { type KeyboardEvent, useId, useRef } from "react";
import { useHashView, VIEWS, type View } from "../../hooks/useHashView.ts";
import { Advanced } from "../Advanced/Advanced.tsx";
import { MainControls } from "../MainControls/MainControls.tsx";
import { StatusBar } from "../StatusBar/StatusBar.tsx";
import styles from "./App.module.css";

const TAB_LABELS: Record<View, string> = { controls: "Controls", advanced: "Advanced" };

/** The status bar, then the everyday controls or the full parameter list (tabs). */
export function App() {
  const [view, setView] = useHashView();
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});
  const tabId = (v: View) => `${baseId}-tab-${v}`;
  const panelId = `${baseId}-panel`;

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onTabKeyDown = (event: KeyboardEvent) => {
    const i = VIEWS.indexOf(view);
    const next =
      event.key === "ArrowRight"
        ? VIEWS[(i + 1) % VIEWS.length]
        : event.key === "ArrowLeft"
          ? VIEWS[(i - 1 + VIEWS.length) % VIEWS.length]
          : event.key === "Home"
            ? VIEWS[0]
            : event.key === "End"
              ? VIEWS[VIEWS.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    setView(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={styles.app}>
      <StatusBar />
      <div className={styles.tabs} role="tablist" aria-label="Views" onKeyDown={onTabKeyDown}>
        {VIEWS.map((v) => (
          <button
            key={v}
            ref={(el) => {
              tabRefs.current[v] = el;
            }}
            id={tabId(v)}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={view === v}
            aria-controls={panelId}
            tabIndex={view === v ? 0 : -1}
            onClick={() => setView(v)}
          >
            {TAB_LABELS[v]}
          </button>
        ))}
      </div>
      <main className={styles.main} id={panelId} role="tabpanel" aria-labelledby={tabId(view)}>
        {view === "advanced" ? <Advanced /> : <MainControls />}
      </main>
    </div>
  );
}
