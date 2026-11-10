import { describe, expect, test } from "bun:test";
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
});
