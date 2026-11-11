import { type KeyboardEvent, useId, useRef } from "react";
import { useHashView, VIEWS, type View } from "../../hooks/useHashView.ts";
import { Advanced } from "../Advanced/Advanced.tsx";
import { Equalizer } from "../Equalizer/Equalizer.tsx";
import { Icon, type IconName } from "../Icon/Icon.tsx";
import { MainControls } from "../MainControls/MainControls.tsx";
import { Settings } from "../Settings/Settings.tsx";
import { StatusBar } from "../StatusBar/StatusBar.tsx";
import styles from "./App.module.css";

const TABS: Record<View, { label: string; icon: IconName }> = {
  home: { label: "Home", icon: "home" },
  advanced: { label: "Advanced", icon: "sliders" },
  eq: { label: "EQ", icon: "eq" },
  settings: { label: "Settings", icon: "settings" },
};

const NEXT: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * The shell: a labelled rail of views (a bottom tab bar on phones), the status bar, and the
 * current view. The rail is a WAI-ARIA tablist with automatic activation.
 */
export function App() {
  const [view, setView] = useHashView();
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});
  const tabId = (v: View) => `${baseId}-tab-${v}`;
  const panelId = `${baseId}-panel`;

  const onTabKeyDown = (event: KeyboardEvent) => {
    const i = VIEWS.indexOf(view);
    const step = NEXT[event.key];
    const next =
      step !== undefined
        ? VIEWS[(i + step + VIEWS.length) % VIEWS.length]
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
      <nav className={styles.rail} aria-label="CP750">
        <span className={styles.brand} aria-hidden="true">
          CP750
        </span>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Views"
          aria-orientation="vertical"
          onKeyDown={onTabKeyDown}
        >
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
              <Icon name={TABS[v].icon} className={styles.tabIcon} />
              {TABS[v].label}
            </button>
          ))}
        </div>
      </nav>
      <div className={styles.column}>
        <StatusBar />
        <main className={styles.main} id={panelId} role="tabpanel" aria-labelledby={tabId(view)}>
          {view === "advanced" ? (
            <Advanced />
          ) : view === "eq" ? (
            <Equalizer />
          ) : view === "settings" ? (
            <Settings />
          ) : (
            <MainControls />
          )}
        </main>
      </div>
    </div>
  );
}
