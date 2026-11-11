import { describe, expect, test } from "bun:test";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { createFakeGateway } from "../../../test/fake-gateway.ts";
import { renderWithGateway } from "../../../test/render.tsx";
import { StatusBar } from "./StatusBar.tsx";

const banner = (key: string) =>
  document.querySelector(`[data-banner="${key}"]`)?.textContent ?? null;

describe("StatusBar", () => {
  test("warns about an unverified nearest-match manifest", async () => {
    const gateway = createFakeGateway({
      device: {
        firmware: "1.2.9.1",
        manifest: { firmware: "1.2.8.3", status: "draft", match: "nearest", verified: false },
      },
    });
    renderWithGateway(<StatusBar />, { gateway });
    await screen.findByText("nearest match");
    expect(screen.getByText("Unverified (draft)")).toBeTruthy();
    expect(banner("manifest")).toContain("nearest older one (1.2.8.3)");
  });

  test("warns loudly when the processor is down, and follows connection events", async () => {
    const gateway = createFakeGateway({
      device: {
        connection: "reconnecting",
        lastError: { code: "ECONNREFUSED", message: "connection refused" },
      },
    });
    const { events } = renderWithGateway(<StatusBar />, { gateway });
    await screen.findByText("Reconnecting…");
    expect(banner("connection")).toContain("Processor offline (connection refused)");

    gateway.device.connection = "connected";
    gateway.device.lastError = null;
    act(() =>
      events().emit("connection", {
        type: "connection",
        connection: "connected",
        error: null,
        at: "2026-11-10T12:00:00.000Z",
      }),
    );
    await screen.findByText("Connected");
    expect(banner("connection")).toBeNull();
  });

  test("shows read-only mode", async () => {
    renderWithGateway(<StatusBar />, {
      gateway: createFakeGateway({ device: { readOnly: true } }),
    });
    await waitFor(() => expect(banner("read-only")).toContain("refuses every change"));
    expect(screen.getByText("Read-only")).toBeTruthy();
  });

  test("warns when the gateway itself is unreachable", async () => {
    const { events } = renderWithGateway(<StatusBar />);
    act(() => events().fail());
    await waitFor(() => expect(banner("gateway")).toContain("Can't reach the CP750 gateway"));
  });

  test("takes the API token when the gateway requires one", async () => {
    const { tokens } = renderWithGateway(<StatusBar />, {
      gateway: createFakeGateway({ device: { authRequired: true } }),
    });
    const toggle = await screen.findByRole("button", { name: "Token: not set" });
    await waitFor(() => expect(banner("auth")).toContain("needs an API token"));
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: " s3cret " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(tokens.get()).toBe("s3cret");
    expect(screen.getByRole("button", { name: "Token: set" })).toBeTruthy();
    expect(banner("auth")).toBeNull();
  });
});
