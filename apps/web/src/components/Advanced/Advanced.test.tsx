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
  test("lists params by group without reading any of them up front", async () => {
    const gateway = createFakeGateway({ commands: manyCommands() });
    renderWithGateway(<Advanced />, { gateway });
    await screen.findByText("350 parameters");
    // The 340 extra `cp750.sys.level_*` params are room calibration.
    const calibration = screen.getByRole("button", { name: /Room calibration cp750\.sys\.\*/ });
    expect(calibration.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(calibration);
    expect(calibration.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listitem").length).toBe(340);
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
      ...["63", "80", "100"].map((n) =>
        command(`cp750.sys.eq_l_${n}`, {
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
    fireEvent.click(screen.getByRole("button", { name: /Equalizer · L cp750\.sys\.eq_l_\*/ }));
    const row = rowOf("cp750.sys.eq_l_63");
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

  test("a fader-unit param steps like the main fader: no free-form entry, reset ramps", async () => {
    const gateway = createFakeGateway({ values: { "cp750.sys.fader": 20 } });
    renderWithGateway(<Advanced />, { gateway });
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search" }), {
      target: { value: "main fader" },
    });
    const row = rowOf("cp750.sys.fader");
    fireEvent.click(within(row).getByRole("button", { name: "Read cp750.sys.fader" }));
    await waitFor(() => expect(row.textContent).toContain("2.0"));
    expect(within(row).queryByRole("slider")).toBeNull();
    expect(within(row).queryByRole("spinbutton")).toBeNull();
    expect(within(row).getByRole("button", { name: "+1.0 cp750.sys.fader" })).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: "Reset to 7.0 cp750.sys.fader" }));
    const sent = () => gateway.paramRequests("PUT").map((r) => (r.body as { value: number }).value);
    await waitFor(() => expect(sent().at(-1)).toBe(70), { timeout: 3000 });
    // Never more than one page (1.0 on the display) per write.
    [20, ...sent()].reduce((from, to) => {
      expect(Math.abs(to - from)).toBeLessThanOrEqual(10);
      return to;
    });
  });

  test("0/1 params and short enums use the main controls' toggle and choice surfaces", async () => {
    renderWithGateway(<Advanced />);
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search" }), {
      target: { value: "cp750.sys" },
    });
    const mute = rowOf("cp750.sys.mute");
    fireEvent.click(within(mute).getByRole("button", { name: "Read cp750.sys.mute" }));
    const toggle = await within(mute).findByRole("button", {
      name: "cp750.sys.mute",
      pressed: false,
    });
    expect(toggle.textContent).toContain("Audio on");

    // The fixture's four short inputs fit one line: the input selector's choice surface.
    const input = rowOf("cp750.sys.input_mode");
    fireEvent.click(within(input).getByRole("button", { name: "Read cp750.sys.input_mode" }));
    await within(input).findByRole("button", { name: /dig_1/, pressed: true });
    expect(within(input).queryByRole("combobox")).toBeNull();
  });

  test("splits cp750.sys.* by what the params do, and the equalizer per channel, low to high", async () => {
    const eq = (name: string) =>
      command(`cp750.sys.${name}`, { schema: { type: "integer", minimum: -60, maximum: 60 } });
    const commands = [
      ...fixtureCommands(),
      eq("eq_c_100"),
      eq("eq_l_1_25k"),
      eq("eq_l_63"),
      eq("eq_l_1k"),
    ];
    renderWithGateway(<Advanced />, { gateway: createFakeGateway({ commands }) });
    await screen.findByText("14 parameters");
    const sections = screen
      .getAllByRole("button", { expanded: false })
      .map((b) => b.textContent?.replace(/\d+ parameters$/, "").trim());
    expect(sections.slice(0, 4)).toEqual([
      "Fader & mutecp750.sys.*",
      "Inputscp750.sys.*",
      "Equalizer · Lcp750.sys.eq_l_*",
      "Equalizer · Ccp750.sys.eq_c_*",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Equalizer · L/ }));
    const bands = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("code [aria-hidden]")?.textContent);
    expect(bands).toEqual(["cp750.sys.eq_l_63", "cp750.sys.eq_l_1k", "cp750.sys.eq_l_1_25k"]);
  });
});
