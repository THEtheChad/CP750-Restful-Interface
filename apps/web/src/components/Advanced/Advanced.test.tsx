import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createFakeGateway } from "../../../test/fake-gateway.ts";
import { command, fixtureCommands } from "../../../test/fixtures.ts";
import { renderWithGateway } from "../../../test/render.tsx";
import { Advanced } from "./Advanced.tsx";

/** The row whose name is `name` (names are split into a muted prefix and the rest). */
function rowOf(name: string): HTMLElement {
  const row = screen
    .getAllByRole("listitem")
    .find((li) => li.querySelector("code [aria-hidden]")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

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
    const row = rowOf("cp750.sys.hostname");
    fireEvent.click(within(row).getByRole("button", { name: "Read cp750.sys.hostname" }));
    await waitFor(() =>
      expect((within(row).getByRole("textbox") as HTMLInputElement).value).toBe("booth-1"),
    );
    expect(gateway.paramRequests().map((r) => r.path)).toEqual(["/api/params/cp750.sys.hostname"]);
    expect(within(row).getByRole("button", { name: "Refresh cp750.sys.hostname" })).toBeTruthy();
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
    // Locked params are outside the default (Available) scope, and the list says so.
    expect(screen.getByText(/1 more match is locked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    const row = rowOf("cp750.sys.hostname");
    expect(within(row).getByText("Unverified")).toBeTruthy();
    expect(within(row).getByText(/manifest is unverified/)).toBeTruthy();
    // No disabled control for a param that can't be changed: its value is shown as text.
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(within(row).getByRole("button", { name: "Read cp750.sys.hostname" })).toBeTruthy();
  });

  test("hides full-set params by default and explains them once", async () => {
    const commands = [
      ...fixtureCommands(),
      ...["a", "b", "c"].map((n) =>
        command(`cp750.sys.eq_${n}`, {
          tier: "full",
          operations: [],
          blocked: { read: "full-tier", write: "full-tier" },
        }),
      ),
    ];
    renderWithGateway(<Advanced />, { gateway: createFakeGateway({ commands }) });
    await screen.findByText("10 of 13 parameters");
    const notice = document.querySelector('[data-notice="full-tier"]') as HTMLElement;
    expect(notice.textContent).toContain("3 parameters are hidden");
    expect(notice.textContent).toContain("CP750_ALLOW_FULL=1");
    fireEvent.click(within(notice).getByRole("button", { name: "Show locked" }));
    expect(screen.getByText("3 of 13 parameters")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Locked/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /System cp750\.sys\.\*/ }));
    const row = rowOf("cp750.sys.eq_a");
    // The short label is visible; the full sentence (said once above) stays for screen readers.
    expect(within(row).getByText("Full set")).toBeTruthy();
    expect(within(row).getByText(/CP750_ALLOW_FULL=1/).className).toBe("visually-hidden");
    expect(within(row).getByText("Not readable")).toBeTruthy();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  test("an empty search offers to clear it and puts focus back in the search box", async () => {
    renderWithGateway(<Advanced />);
    const search = await screen.findByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "nothing-like-this" } });
    expect(screen.getByText(/No available parameters match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(search);
  });
});
