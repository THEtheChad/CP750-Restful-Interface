import { type FormEvent, useId, useState } from "react";
import { useToken, useTokenStore } from "../../../../api/hooks.ts";
import controls from "../../../../styles/controls.module.css";
import styles from "./AuthControl.module.css";

/** The API token, for gateways started with `CP750_API_TOKEN`. Kept for this tab only. */
export function AuthControl() {
  const tokens = useTokenStore();
  const token = useToken();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const panelId = useId();
  const inputId = useId();

  const save = (event: FormEvent) => {
    event.preventDefault();
    tokens.set(draft);
    setDraft("");
    setOpen(false);
  };

  return (
    <div className={styles.auth}>
      <button
        type="button"
        className={`${controls.button} ${controls.small}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        Token:{" "}
        <span className={token ? styles.set : styles.unset}>{token ? "set" : "not set"}</span>
      </button>
      <div id={panelId} className={styles.panel} hidden={!open}>
        <form className={styles.form} onSubmit={save}>
          <label className={styles.label} htmlFor={inputId}>
            API token
          </label>
          <input
            id={inputId}
            className={controls.field}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={token ? "•••••• (saved)" : ""}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className={styles.note}>Sent with every change. Kept for this browser tab only.</p>
          <div className={styles.actions}>
            <button
              type="submit"
              className={`${controls.button} ${controls.primary}`}
              disabled={!draft.trim()}
            >
              Save
            </button>
            <button
              type="button"
              className={controls.button}
              disabled={!token}
              onClick={() => {
                tokens.set(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
