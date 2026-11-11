import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { useElementWidth } from "../../../../hooks/useElementWidth.ts";
import { formatHz } from "../../../../lib/param-groups.ts";
import styles from "./EqCurve.module.css";

export interface EqBandValue {
  name: string;
  hz: number;
  /** The processor's value, or `undefined` while unread (the line breaks there). */
  value: number | undefined;
  /** A write to this band is in flight. */
  pending: boolean;
}

export interface EqCurveProps {
  bands: EqBandValue[];
  selected: number;
  min: number;
  max: number;
  /** Changes are allowed (Edit EQ is on); otherwise the curve only selects bands. */
  armed: boolean;
  /** Direct node dragging (desktop); on phones the curve only selects. */
  draggable: boolean;
  /** Where the selected band is being dragged to, while the processor catches up. */
  dragValue: number | null;
  label: string;
  onSelect: (index: number) => void;
  /** A new value for the selected band (drag move or key); the caller throttles the writes. */
  onChange: (value: number) => void;
  onRelease: () => void;
}

const PAD = { left: 40, right: 14, top: 14, bottom: 28 };
const GRID_LABELS = [40, 100, 250, 1000, 4000, 16000];

/**
 * One channel's third-octave EQ as Pro-Q draws it: a faint grid, a crisp line through the bands
 * (straight segments: the CP750 gives band values, not a filter response we could compute) with a
 * translucent fill to 0, and a node per band. The y axis shows the processor's raw values, not
 * dB: the unit isn't documented. Unread bands break the line; pending bands are dashed.
 *
 * Keyboard: one tab stop (roving), each node a `role="slider"`: ←/→ select the band, ↑/↓ ±1,
 * Page Up/Down ±10, Home/End to the ends (only while armed). The SVG drawing itself is hidden
 * from assistive tech; the List view is the readable alternative.
 */
export function EqCurve({
  bands,
  selected,
  min,
  max,
  armed,
  draggable,
  dragValue,
  label,
  onSelect,
  onChange,
  onRelease,
}: EqCurveProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(SVGCircleElement | null)[]>([]);
  const dragging = useRef(false);
  const width = useElementWidth(wrapRef, 960);
  const height = width < 520 ? 240 : 360;
  const pw = width - PAD.left - PAD.right;
  const ph = height - PAD.top - PAD.bottom;
  const n = bands.length;
  const x = (i: number) => PAD.left + (i + 0.5) * (pw / n);
  const y = (v: number) => PAD.top + ((max - v) / (max - min)) * ph;
  /** The value under a pointer at `clientY` (the SVG may be scaled: map to viewBox units first). */
  const valueAt = (clientY: number, rect: DOMRect) => {
    const py = ((clientY - rect.top) / rect.height) * height;
    return Math.round(max - ((py - PAD.top) / ph) * (max - min));
  };
  const bandAt = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(n - 1, Math.floor((px - PAD.left) / (pw / n))));
  };
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const shownValue = (i: number) =>
    i === selected && dragValue !== null ? dragValue : bands[i]?.value;

  // The line, broken where a band is unread.
  const segments: string[] = [];
  let run: string[] = [];
  bands.forEach((_, i) => {
    const v = shownValue(i);
    if (v === undefined) {
      if (run.length) segments.push(run.join(" "));
      run = [];
    } else run.push(`${x(i)},${y(v)}`);
  });
  if (run.length) segments.push(run.join(" "));
  const zero = y(clamp(0));

  const grid: number[] = [];
  const step = (max - min) / 6;
  for (let v = min; v <= max + 1e-9; v += step) grid.push(Math.round(v));

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const index = bandAt(event.clientX, rect);
    if (index !== selected) {
      onSelect(index);
      nodeRefs.current[index]?.focus();
      return;
    }
    nodeRefs.current[index]?.focus();
    if (!armed || !draggable) return;
    dragging.current = true;
    svg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    onChange(clamp(valueAt(event.clientY, rect)));
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(clamp(valueAt(event.clientY, rect)));
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onRelease();
  };

  const onKeyDown = (event: KeyboardEvent<SVGCircleElement>, i: number) => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const next = Math.max(0, Math.min(n - 1, i + move));
      onSelect(next);
      nodeRefs.current[next]?.focus();
      return;
    }
    if (!armed) return;
    const current = shownValue(i);
    if (current === undefined) return;
    const delta = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[event.key];
    const next =
      delta !== undefined
        ? current + delta
        : event.key === "Home"
          ? min
          : event.key === "End"
            ? max
            : null;
    if (next === null) return;
    event.preventDefault();
    onChange(clamp(next));
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG can't be a <fieldset>; it groups the band sliders. */}
      <svg
        className={styles.plot}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={label}
        data-armed={armed || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative lines and labels only; nothing in this group takes focus. */}
        <g aria-hidden="true">
          {grid.map((v) => (
            <g key={`h${v}`}>
              <line
                className={v === 0 ? styles.zero : styles.grid}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(v)}
                y2={y(v)}
              />
              <text className={styles.axis} x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
                {v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0"}
              </text>
            </g>
          ))}
          {bands.map((b, i) =>
            GRID_LABELS.includes(b.hz) ? (
              <g key={`v${b.hz}`}>
                <line
                  className={styles.grid}
                  x1={x(i)}
                  x2={x(i)}
                  y1={PAD.top}
                  y2={height - PAD.bottom}
                />
                <text className={styles.axis} x={x(i)} y={height - 9} textAnchor="middle">
                  {b.hz >= 1000 ? `${b.hz / 1000}k` : b.hz}
                </text>
              </g>
            ) : null,
          )}
          <rect
            className={styles.column}
            x={x(selected) - pw / n / 2}
            y={PAD.top}
            width={pw / n}
            height={ph}
          />
          {segments.map((pts) => {
            const coords = pts.split(" ");
            const first = coords[0]?.split(",")[0];
            const last = coords[coords.length - 1]?.split(",")[0];
            return (
              <g key={pts}>
                <polygon
                  className={styles.area}
                  points={`${first},${zero} ${pts} ${last},${zero}`}
                />
                <polyline className={styles.curve} points={pts} />
              </g>
            );
          })}
        </g>
        {bands.map((b, i) => {
          const v = shownValue(i);
          const sel = i === selected;
          return (
            <circle
              key={b.name}
              ref={(el) => {
                nodeRefs.current[i] = el;
              }}
              className={sel ? `${styles.node} ${styles.selected}` : styles.node}
              data-pending={b.pending || undefined}
              cx={x(i)}
              cy={y(v === undefined ? clamp(0) : v)}
              r={sel ? (width < 520 ? 6 : 7) : width < 520 ? 3 : 5}
              visibility={v === undefined ? "hidden" : undefined}
              role="slider"
              tabIndex={sel ? 0 : -1}
              aria-label={`${formatHz(b.hz)}, band ${i + 1} of ${n}`}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={v}
              aria-valuetext={v === undefined ? "not read" : `${v}${b.pending ? ", setting" : ""}`}
              aria-readonly={!armed || undefined}
              onKeyDown={(event) => onKeyDown(event, i)}
              onKeyUp={() => onRelease()}
              onFocus={() => {
                if (!sel) onSelect(i);
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}
