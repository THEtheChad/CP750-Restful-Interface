import { useId } from "react";
import { ProcessorFacts } from "../ProcessorFacts/ProcessorFacts.tsx";
import { Fader } from "./components/Fader/Fader.tsx";
import { InputSelector } from "./components/InputSelector/InputSelector.tsx";
import { MuteToggle } from "./components/MuteToggle/MuteToggle.tsx";
import styles from "./MainControls.module.css";
import section from "./section.module.css";

/**
 * Home: the master strip (Mute beside the level readout, the vertical fader and its steps), the
 * input keys, and what we know about the processor.
 */
export function MainControls() {
  const factsId = useId();
  return (
    <div className={styles.controls}>
      <Fader beside={<MuteToggle />} />
      <InputSelector />
      <section className={`${section.section} ${styles.facts}`} aria-labelledby={factsId}>
        <div className={section.header}>
          <h2 className={section.heading} id={factsId}>
            Processor
          </h2>
        </div>
        <ProcessorFacts />
      </section>
    </div>
  );
}
