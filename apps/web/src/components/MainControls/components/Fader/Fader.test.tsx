import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createFakeGateway, problem } from "../../../../../test/fake-gateway.ts";
import { renderWithGateway } from "../../../../../test/render.tsx";
import { Fader } from "./Fader.tsx";

const slider = () => screen.getByRole("slider") as HTMLInputElement;
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
    fireEvent.click(screen.getByRole("button", { name: "Return fader to 7.0 (0 dB)" }));
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(70));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([
      { value: 71 },
      { value: 61 },
      { value: 70 },
    ]);
  });

  test("a drag is throttled and the final value is committed on release", async () => {
    const { gateway } = renderWithGateway(<Fader throttleMs={1_000} />);
    await ready();
    for (let v = 71; v <= 90; v++) fireEvent.change(slider(), { target: { value: String(v) } });
    // The display follows the drag at once…
    expect(screen.getByTestId("fader-value").textContent).toBe("9.0");
    // …but only the first value went out; the rest wait, newest only.
    await waitFor(() => expect(gateway.paramRequests("PUT").length).toBe(1));
    fireEvent.pointerUp(slider());
    await waitFor(() => expect(gateway.values.get("cp750.sys.fader")).toBe(90));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: 71 }, { value: 90 }]);
    await waitFor(() => expect(screen.getByTestId("fader-db").textContent).toBe("+6.7 dB"));
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
    await waitFor(() => expect(slider().disabled).toBe(true));
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The gateway is in read-only mode.")).toBeTruthy();
    expect(slider().getAttribute("aria-describedby")).toBeTruthy();
  });
});
