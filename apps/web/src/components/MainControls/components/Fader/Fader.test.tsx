import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createFakeGateway, problem } from "../../../../../test/fake-gateway.ts";
import { renderWithGateway } from "../../../../../test/render.tsx";
import { Fader } from "./Fader.tsx";

const slider = () => screen.getByRole("slider") as HTMLElement;
/** happy-dom has no layout: give the fader a 400px track (raw 100 at the top, 0 at the bottom). */
const TRACK = 400;
const yOf = (raw: number) => TRACK - (raw / 100) * TRACK;
function layout() {
  slider().getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 112,
      bottom: TRACK,
      width: 112,
      height: TRACK,
      x: 0,
      y: 0,
    }) as DOMRect;
}
const press = (raw: number) => fireEvent.pointerDown(slider(), { clientY: yOf(raw), pointerId: 1 });
const move = (raw: number) => fireEvent.pointerMove(slider(), { clientY: yOf(raw), pointerId: 1 });
const release = (raw: number) => fireEvent.pointerUp(slider(), { clientY: yOf(raw), pointerId: 1 });
const ready = () =>
  waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("7.0"));

describe("Fader", () => {
  test("reads the fader and shows raw/10 with dB from the API", async () => {
    const gateway = createFakeGateway({ values: { "cp750.sys.fader": 40 } });
    renderWithGateway(<Fader />, { gateway });
    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("4.0"));
    expect(screen.getByTestId("fader-db").textContent).toBe("−10.0 dB");
    expect(slider().getAttribute("aria-valuetext")).toBe("4.0, −10.0 dB");
  });

  test("steps by ±0.1 and ±1.0 and returns to 7.0", async () => {
    const { gateway } = renderWithGateway(<Fader />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Fader +0.1" }));
    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("7.1"));
    fireEvent.click(screen.getByRole("button", { name: "Fader −1.0" }));
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(61));
    fireEvent.click(screen.getByRole("button", { name: "Reset to 7.0" }));
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(70));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([
      { value: 71 },
      { value: 61 },
      { value: 70 },
    ]);
  });

  test("a drag from the cap follows at once, throttled, and commits on release", async () => {
    const { gateway } = renderWithGateway(<Fader throttleMs={1_000} />);
    await ready();
    layout();
    press(70);
    for (let v = 71; v <= 80; v++) move(v);
    // The cap follows the drag at once (dashed, as a target); the readout stays on what the
    // processor confirmed and says where it is going.
    expect(slider().getAttribute("aria-valuenow")).toBe("8");
    expect(screen.getByText("Setting 8.0…")).toBeTruthy();
    // Only the first value went out; the rest wait, newest only.
    await waitFor(() => expect(gateway.paramRequests("PUT").length).toBe(1));
    release(80);
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(80));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: 71 }, { value: 80 }]);
    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("8.0"));
    await waitFor(() => expect(screen.getByTestId("fader-db").textContent).toBe("+3.3 dB"));
  });

  test("no single send moves more than 1.0: a jump ramps there one page at a time", async () => {
    const { gateway } = renderWithGateway(<Fader throttleMs={20} />);
    await ready();
    // End on the keyboard: straight to 10.0.
    fireEvent.keyDown(slider(), { key: "End" });
    fireEvent.keyUp(slider(), { key: "End" });
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(100));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([
      { value: 80 },
      { value: 90 },
      { value: 100 },
    ]);
  });

  test("a failed send stops the move: the rest of a ramp is dropped, not retried", async () => {
    const gateway = createFakeGateway();
    gateway.intercept((r) =>
      r.method === "PUT"
        ? problem(504, "TIMEOUT", { title: "The CP750 did not answer" })
        : undefined,
    );
    renderWithGateway(<Fader throttleMs={20} />, { gateway });
    await ready();
    fireEvent.keyDown(slider(), { key: "End" });
    fireEvent.keyUp(slider(), { key: "End" });
    expect((await screen.findByRole("alert")).textContent).toContain("didn't answer in time");
    await new Promise((r) => setTimeout(r, 200));
    // One attempt (7.0 → 8.0) failed; 9.0 and 10.0 were never sent.
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: 80 }]);
    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("7.0"));
  });

  test("a tap on the track moves one page toward it; a drag only starts on the cap", async () => {
    const { gateway } = renderWithGateway(<Fader />);
    await ready();
    layout();
    // A tap near the top of the track (far from the cap at 7.0): one page up, not to 10.0.
    press(100);
    release(100);
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(80));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: 80 }]);

    // A swipe that starts on the track (a scroll that landed there) never sets the level.
    press(20);
    move(40);
    move(60);
    release(60);
    await new Promise((r) => setTimeout(r, 300));
    expect(gateway.paramRequests("PUT").length).toBe(1);

    // A drag that starts on the cap follows (within the per-send cap).
    press(80);
    for (const v of [81, 82, 85]) move(v);
    release(85);
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(85));
  });

  test("a cancelled drag drops what is queued instead of sending it", async () => {
    const { gateway } = renderWithGateway(<Fader throttleMs={1_000} />);
    await ready();
    layout();
    press(70);
    move(75);
    move(79);
    fireEvent.pointerCancel(slider(), { pointerId: 1 });
    await new Promise((r) => setTimeout(r, 50));
    // The first move had already gone out; the queued 79 is dropped.
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: 75 }]);
  });

  test("the wheel cannot change the level", async () => {
    const { gateway } = renderWithGateway(<Fader />);
    await ready();
    slider().dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(gateway.paramRequests("PUT").length).toBe(0);
    expect(slider().getAttribute("aria-valuenow")).toBe("7");
  });

  test("steps re-read the processor first, so a stale display cannot cause a jump", async () => {
    const { gateway } = renderWithGateway(<Fader />);
    await ready();
    // Someone turns the unit down to 5.0 on the front panel; the display still says 7.0.
    gateway.values.set("cp750.sys.fader", 50);
    expect(screen.getByTestId("fader-value").textContent).toBe("7.0");
    fireEvent.click(screen.getByRole("button", { name: "Fader +0.1" }));
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(51));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: 51 }]);
    const requests = gateway.paramRequests().map((r) => r.method);
    expect(requests.lastIndexOf("GET")).toBeLessThan(requests.indexOf("PUT"));
  });

  test("quick repeated steps each start from the previous result", async () => {
    const { gateway } = renderWithGateway(<Fader />);
    await ready();
    const plus = screen.getByRole("button", { name: "Fader +0.1" });
    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(73));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([
      { value: 71 },
      { value: 72 },
      { value: 73 },
    ]);
  });

  test("WRITE_REJECTED shows what the processor kept and rolls the display to it", async () => {
    const gateway = createFakeGateway();
    // The unit answers with the value it kept, and holds it from then on.
    gateway.intercept((r) => {
      if (r.method !== "PUT") return undefined;
      gateway.values.set("cp750.sys.fader", 65);
      return problem(422, "WRITE_REJECTED", {
        title: "Write rejected",
        requested: 75,
        actual: 65,
        raw: "65",
      });
    });
    renderWithGateway(<Fader />, { gateway });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Fader +0.1" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The processor kept 6.5");
    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("6.5"));
    await waitFor(() => expect(screen.getByTestId("fader-db").textContent).toBe("−1.7 dB"));
  });

  test("any other error rolls back to the previous value", async () => {
    const gateway = createFakeGateway();
    gateway.intercept((r) =>
      r.method === "PUT"
        ? problem(504, "TIMEOUT", { title: "The CP750 did not answer" })
        : undefined,
    );
    renderWithGateway(<Fader />, { gateway });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Fader +1.0" }));
    expect((await screen.findByRole("alert")).textContent).toContain("didn't answer in time");
    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("7.0"));
  });

  test("read-only mode disables every fader control and says why", async () => {
    const gateway = createFakeGateway({ device: { readOnly: true } });
    renderWithGateway(<Fader />, { gateway });
    await ready();
    await waitFor(() => expect(slider().getAttribute("aria-disabled")).toBe("true"));
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The gateway is in read-only mode.")).toBeTruthy();
    expect(slider().getAttribute("aria-describedby")).toBeTruthy();
  });
});
