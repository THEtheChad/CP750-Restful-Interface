import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithGateway } from "../../../test/render.tsx";
import { App } from "./App.tsx";

describe("App (root render)", () => {
  test("shows the device status and the main controls with live values", async () => {
    renderWithGateway(<App />);
    const header = screen.getByRole("banner");
    await waitFor(() => expect(within(header).getByText("192.168.1.136:61408")).toBeTruthy());
    expect(within(header).getByText("Connected")).toBeTruthy();
    expect(within(header).getByText("✓ verified")).toBeTruthy();
    expect(within(header).getByText("exact match")).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("7.0"));
    expect(screen.getByTestId("fader-db").textContent).toBe("0.0 dB");
    expect(screen.getByRole("button", { name: "Mute" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /Digital 1/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("switches to the advanced view with the tabs", async () => {
    renderWithGateway(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByRole("tab", { name: "Advanced" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "All parameters" })).toBeTruthy(),
    );
    expect(window.location.hash).toBe("#advanced");
  });

  test("the stream's opening snapshots do not refetch what was just loaded", async () => {
    const { gateway, events } = renderWithGateway(<App />);
    await waitFor(() => expect(screen.getByTestId("fader-value").textContent).toBe("7.0"));
    const at = new Date().toISOString();
    // What /api/events sends first: the same state /api/device just returned.
    events().open();
    events().emit("connection", {
      type: "connection",
      connection: gateway.device.connection,
      error: gateway.device.lastError,
      at,
    });
    events().emit("device", {
      type: "device",
      firmware: gateway.device.firmware,
      manifest: gateway.device.manifest,
      at,
    });
    await new Promise((r) => setTimeout(r, 50));
    const count = (path: string) => gateway.requests.filter((r) => r.path === path).length;
    expect(count("/api/device")).toBe(1);
    expect(count("/api/commands")).toBe(1);
  });
});
