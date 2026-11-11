import { Fader } from "./components/Fader/Fader.tsx";
import { InputSelector } from "./components/InputSelector/InputSelector.tsx";
import { MuteToggle } from "./components/MuteToggle/MuteToggle.tsx";
import styles from "./MainControls.module.css";

/** The everyday controls: the fader leads; mute and input sit beside it (below on phones). */
export function MainControls() {
  return (
    <div className={styles.controls}>
      <div className={styles.primary}>
        <Fader />
      </div>
      <div className={styles.side}>
        <MuteToggle />
        <InputSelector />
      </div>
    </div>
  );
}
