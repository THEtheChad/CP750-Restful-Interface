import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createFakeGateway } from "../../../test/fake-gateway.ts";
import { command, fixtureCommands } from "../../../test/fixtures.ts";
import { renderWithGateway } from "../../../test/render.tsx";
import { Equalizer } from "./Equalizer.tsx";

const schema = { type: "integer" as const, minimum: -60, maximum: 60 };
const bands = (channel: string, extra = {}) =>
  ["63", "1k", "4k"].map((b) => command(`cp750.sys.eq_${channel}_${b}`, { schema, ...extra }));

describe("Equalizer", () => {
  test("is read-only until Edit EQ is on; then ±1 changes the selected band", async () => {
    const gateway = createFakeGateway({
      commands: [...fixtureCommands(), ...bands("l"), ...bands("c")],
      values: { "cp750.sys.eq_l_63": 0, "cp750.sys.eq_l_1k": 4, "cp750.sys.eq_l_4k": -2 },
    });
    renderWithGateway(<Equalizer />, { gateway });
    // The middle band of the channel's three is selected (index clamps to the last one).
    await waitFor(() => expect(screen.getByTestId("band-value").textContent).toBe("−2"));
    const plus = () => screen.getByRole("button", { name: "4 kHz +1" }) as HTMLButtonElement;
    expect(plus().disabled).toBe(true);
    expect(screen.getByText("Read only: turn on Edit EQ to change")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit EQ" }));
    fireEvent.click(plus());
    await waitFor(() => expect(gateway.values.get("cp750.sys.eq_l_4k")).toBe(-1));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: -1 }]);

    // Another channel starts read-only again.
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    expect(screen.getByRole("button", { name: "Edit EQ" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  test("Set to 0 asks first, naming the old and new values", async () => {
    const gateway = createFakeGateway({
      commands: [...fixtureCommands(), ...bands("l")],
      values: { "cp750.sys.eq_l_63": 0, "cp750.sys.eq_l_1k": 4, "cp750.sys.eq_l_4k": 12 },
    });
    renderWithGateway(<Equalizer />, { gateway });
    await waitFor(() => expect(screen.getByTestId("band-value").textContent).toBe("+12"));
    fireEvent.click(screen.getByRole("button", { name: "Edit EQ" }));
    fireEvent.click(screen.getByRole("button", { name: "Set to 0…" }));
    expect(screen.getByText("Set 4 kHz from +12 to 0?")).toBeTruthy();
    expect(gateway.paramRequests("PUT").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Set to 0" }));
    await waitFor(() => expect(gateway.values.get("cp750.sys.eq_l_4k")).toBe(0));
  });

  test("without the full command set it explains why instead of drawing a flat line", async () => {
    const locked = bands("l", {
      tier: "full",
      operations: [],
      blocked: { read: "full-tier", write: "full-tier" },
    });
    renderWithGateway(<Equalizer />, {
      gateway: createFakeGateway({ commands: [...fixtureCommands(), ...locked] }),
    });
    expect(await screen.findByText(/needs the CP750's full command set/)).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    expect((screen.getByRole("button", { name: "Edit EQ" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
