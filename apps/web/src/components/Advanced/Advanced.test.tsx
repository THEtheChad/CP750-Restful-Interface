import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createFakeGateway } from "../../../test/fake-gateway.ts";
import { command, fixtureCommands } from "../../../test/fixtures.ts";
import { renderWithGateway } from "../../../test/render.tsx";
import { Advanced } from "./Advanced.tsx";

/** ~350 params, like a real manifest. */
function manyCommands() {
  const extra = Array.from({ length: 340 }, (_, i) =>
    command(`cp750.sys.level_${String(i).padStart(3, "0")}`, {
      schema: { type: "integer", minimum: -60, maximum: 60 },
    }),
  );
  return [...fixtureCommands(), ...extra];
}

describe("Advanced", () => {
  test("lists params by namespace without reading any of them up front", async () => {
    const gateway = createFakeGateway({ commands: manyCommands() });
    renderWithGateway(<Advanced />, { gateway });
    await screen.findByText("350 parameters");
    const system = screen.getByRole("button", { name: /System cp750\.sys\.\*/ });
    expect(system.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(system);
    expect(system.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listitem").length).toBe(346);
    // Nothing is on screen in happy-dom (no layout), so nothing has been read.
    await new Promise((r) => setTimeout(r, 400));
    expect(gateway.paramRequests().length).toBe(0);
  });

  test("reads one param on demand", async () => {
    const { gateway } = renderWithGateway(<Advanced />);
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search" }), {
      target: { value: "hostname" },
    });
    const row = screen.getByText("cp750.sys.hostname").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Read" }));
    await waitFor(() =>
      expect((within(row).getByRole("textbox") as HTMLInputElement).value).toBe("booth-1"),
    );
    expect(gateway.paramRequests().map((r) => r.path)).toEqual(["/api/params/cp750.sys.hostname"]);
    expect(within(row).getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  test("search and namespace filter narrow the list", async () => {
    renderWithGateway(<Advanced />);
    const search = await screen.findByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "fader" } });
    expect(screen.getByText("2 of 10 parameters")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Namespace" }), {
      target: { value: "ctrl" },
    });
    expect(screen.getByText("2 of 10 parameters")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reboot…" })).toBeTruthy();
  });

  test("shows why a param can't be changed", async () => {
    const commands = fixtureCommands().map((c) =>
      c.name === "cp750.sys.hostname"
        ? { ...c, operations: ["read" as const], blocked: { write: "unverified" as const } }
        : c,
    );
    const gateway = createFakeGateway({ commands });
    renderWithGateway(<Advanced />, { gateway });
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search" }), {
      target: { value: "hostname" },
    });
    const row = screen.getByText("cp750.sys.hostname").closest("li") as HTMLElement;
    expect(within(row).getByText(/manifest is unverified/)).toBeTruthy();
    expect((within(row).getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  });
});
