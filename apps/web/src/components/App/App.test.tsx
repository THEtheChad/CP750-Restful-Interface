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
});
