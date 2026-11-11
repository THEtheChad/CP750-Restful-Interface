import { Fader } from "./components/Fader/Fader.tsx";
import { InputSelector } from "./components/InputSelector/InputSelector.tsx";
import { MuteToggle } from "./components/MuteToggle/MuteToggle.tsx";
import styles from "./MainControls.module.css";

/** The everyday controls: fader, mute and input. */
export function MainControls() {
  return (
    <div className={styles.controls}>
      <Fader />
      <div className={styles.side}>
        <MuteToggle />
        <InputSelector />
      </div>
    </div>
  );
}
