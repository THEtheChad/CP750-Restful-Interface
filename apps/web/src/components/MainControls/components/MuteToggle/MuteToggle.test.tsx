import { describe, expect, setSystemTime, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createFakeGateway, deferred, problem } from "../../../../../test/fake-gateway.ts";
import { command, fixtureCommands } from "../../../../../test/fixtures.ts";
import { renderWithGateway } from "../../../../../test/render.tsx";
import { MUTE_PARAM, MuteToggle } from "./MuteToggle.tsx";

describe("MuteToggle", () => {
  test("is disabled with the reason from /api/commands when mute is blocked (full tier)", async () => {
    const commands = fixtureCommands().map((c) =>
      c.name === MUTE_PARAM
        ? command(MUTE_PARAM, {
            tier: "full",
            schema: { type: "integer", enum: [0, 1] },
            operations: [],
            blocked: { read: "full-tier", write: "full-tier" },
          })
        : c,
    );
    const gateway = createFakeGateway({ commands });
    renderWithGateway(<MuteToggle />, { gateway });
    const reason = await screen.findByText(/CP750_ALLOW_FULL=1/);
    const button = screen.getByRole("button", { name: "Mute" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    // Blocked reads aren't attempted.
    expect(gateway.paramRequests().length).toBe(0);
  });

  test("toggles optimistically and rolls back on error", async () => {
    const gateway = createFakeGateway();
    const held = deferred<Response | undefined>();
    let fail = false;
    gateway.intercept((r) => {
      if (r.method !== "PUT") return undefined;
      return fail ? problem(503, "NOT_CONNECTED") : held.promise;
    });
    renderWithGateway(<MuteToggle />, { gateway });
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));

    // Pressed before the gateway has answered…
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(gateway.values.get(MUTE_PARAM)).toBe(0);
    held.resolve(undefined);
    await waitFor(() => expect(gateway.values.get(MUTE_PARAM)).toBe(1));

    // …and back to the last good state when a write fails.
    fail = true;
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("offline"));
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  test("a double click sends one write: the button ignores clicks while it is pending", async () => {
    const gateway = createFakeGateway();
    const held = deferred<Response | undefined>();
    gateway.intercept((r) => (r.method === "PUT" ? held.promise : undefined));
    renderWithGateway(<MuteToggle />, { gateway });
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(button);
    held.resolve(undefined);
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBeNull());
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([{ value: 1 }]);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  test("shows Stale when live updates stop for a few poll intervals", async () => {
    const gateway = createFakeGateway({ device: { pollMs: 1_000 } });
    const { events } = renderWithGateway(<MuteToggle />, { gateway });
    await screen.findByRole("button", { name: "Mute" });
    events().open();
    try {
      // Live (stream open, connected, polling): fresh however old the last read is.
      setSystemTime(new Date(Date.now() + 60_000));
      await new Promise((r) => setTimeout(r, 1_100));
      expect(screen.queryByText("Stale")).toBeNull();
      // The stream drops; 3 poll intervals later the value is stale.
      events().fail();
      setSystemTime(new Date(Date.now() + 3_500));
      expect(await screen.findByText("Stale", {}, { timeout: 2_000 })).toBeTruthy();
      expect(screen.getByText(/Live updates from the gateway are interrupted/)).toBeTruthy();
    } finally {
      setSystemTime();
    }
  });
});
