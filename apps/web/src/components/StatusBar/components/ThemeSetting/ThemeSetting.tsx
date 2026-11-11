import { useId } from "react";
import { THEMES, type Theme, useTheme } from "../../../../lib/theme.ts";
import styles from "./ThemeSetting.module.css";

const LABELS: Record<Theme, string> = { dark: "Dark", light: "Light", system: "System" };

/** Dark / Light / System as a segmented radio group. */
export function ThemeSetting() {
  const [theme, setTheme] = useTheme();
  const name = useId();
  return (
    <fieldset className={styles.group}>
      <legend className="visually-hidden">Theme</legend>
      {THEMES.map((t) => (
        <label key={t} className={styles.option}>
          <input
            type="radio"
            name={name}
            value={t}
            checked={theme === t}
            onChange={() => setTheme(t)}
          />
          <span>{LABELS[t]}</span>
        </label>
      ))}
    </fieldset>
  );
}
