import { useState } from "react";
import { formatHz } from "../../../../lib/param-groups.ts";
import controls from "../../../../styles/controls.module.css";
import { Icon } from "../../../Icon/Icon.tsx";
import styles from "./BandDock.module.css";

export interface BandDockProps {
  hz: number;
  index: number;
  count: number;
  /** The band's value as shown (the drag target while one is in progress). */
  value: number | undefined;
  pending: boolean;
  armed: boolean;
  /** Why the band can't be changed even when armed (blocked, offline…), or `null`. */
  blocked: string | null;
  onPrev: () => void;
  onNext: () => void;
  onStep: (delta: number) => void;
  onSetZero: () => void;
}

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

/**
 * The selected band, docked under the curve (a floating panel would cover neighbouring bands):
 * previous/next, its frequency and value, ±1 keys, and "Set to 0…" with an inline old → new
 * confirmation (a reset is a real change, never a hidden gesture).
 */
export function BandDock({
  hz,
  index,
  count,
  value,
  pending,
  armed,
  blocked,
  onPrev,
  onNext,
  onStep,
  onSetZero,
}: BandDockProps) {
  const [confirming, setConfirming] = useState(false);
  const canChange = armed && blocked === null && value !== undefined;
  const state =
    value === undefined ? "Not read" : pending ? "Setting…" : armed ? "Confirmed" : null;
  return (
    <div className={`${controls.tray} ${styles.dock}`}>
      <div className={styles.band}>
        <button
          type="button"
          className={`${controls.button} ${controls.small}`}
          aria-label="Previous band"
          disabled={index === 0}
          onClick={onPrev}
        >
          <Icon name="prev" />
        </button>
        <span className={styles.freq}>
          {formatHz(hz)}
          <span className={styles.position}>
            Band {index + 1} of {count}
          </span>
        </span>
        <button
          type="button"
          className={`${controls.button} ${controls.small}`}
          aria-label="Next band"
          disabled={index === count - 1}
          onClick={onNext}
        >
          <Icon name="next" />
        </button>
      </div>
      <p className={styles.value}>
        <span className={styles.number} data-testid="band-value">
          {value === undefined ? "–" : signed(value)}
        </span>
        <span className={styles.unit}>raw value</span>
      </p>
      {confirming && value !== undefined ? (
        <fieldset className={styles.confirm}>
          <legend className="visually-hidden">Confirm</legend>
          <span>
            Set {formatHz(hz)} from {signed(value)} to 0?
          </span>
          <button
            type="button"
            className={`${controls.button} ${controls.small} ${controls.primary}`}
            onClick={() => {
              setConfirming(false);
              onSetZero();
            }}
          >
            Set to 0
          </button>
          <button
            type="button"
            className={`${controls.button} ${controls.small}`}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </fieldset>
      ) : (
        <div className={styles.keys}>
          <button
            type="button"
            className={`${controls.button} ${controls.small}`}
            disabled={!canChange}
            aria-disabled={pending || undefined}
            aria-label={`${formatHz(hz)} −1`}
            onClick={() => !pending && onStep(-1)}
          >
            −1
          </button>
          <button
            type="button"
            className={`${controls.button} ${controls.small}`}
            disabled={!canChange}
            aria-disabled={pending || undefined}
            aria-label={`${formatHz(hz)} +1`}
            onClick={() => !pending && onStep(1)}
          >
            +1
          </button>
          <button
            type="button"
            className={`${controls.button} ${controls.small}`}
            disabled={!canChange || value === 0}
            onClick={() => setConfirming(true)}
          >
            Set to 0…
          </button>
        </div>
      )}
      <p className={styles.state} role="status">
        {!armed ? "Read only: turn on Edit EQ to change" : (blocked ?? state)}
      </p>
    </div>
  );
}
