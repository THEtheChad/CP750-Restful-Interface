import { describe, expect, test } from "bun:test";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { command } from "../../../../../../../../../test/fixtures.ts";
import { renderWithGateway } from "../../../../../../../../../test/render.tsx";
import { ActionButton } from "./ActionButton.tsx";

const reboot = command("cp750.ctrl.reboot", {
  destructive: true,
  schema: { type: "integer", minimum: 0, maximum: 2147483647 },
});

describe("ActionButton: destructive confirmation", () => {
  test("needs a second, explicit step and then sends confirm: true", async () => {
    const { gateway } = renderWithGateway(<ActionButton command={reboot} reason={null} />);
    const trigger = screen.getByRole("button", { name: "Reboot…" });
    fireEvent.click(trigger);

    // Nothing is sent by the first click; the confirmation opens with focus on Cancel.
    expect(gateway.paramRequests().length).toBe(0);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(screen.getByRole("group").textContent).toContain("the sound stops");

    fireEvent.click(screen.getByRole("button", { name: "Yes, reboot" }));
    // Focus returns to the trigger, which stays focusable while the action is pending.
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(gateway.paramRequests("POST").length).toBe(1));
    const [request] = gateway.paramRequests("POST");
    expect(request?.path).toBe("/api/actions/cp750.ctrl.reboot");
    expect(request?.body).toEqual({ confirm: true });
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  test("Cancel and Escape close it without sending, and return focus", () => {
    const { gateway } = renderWithGateway(<ActionButton command={reboot} reason={null} />);
    const trigger = screen.getByRole("button", { name: "Reboot…" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    expect(gateway.paramRequests().length).toBe(0);
  });

  test("the confirmation expires on its own and returns focus to the trigger", async () => {
    renderWithGateway(<ActionButton command={reboot} reason={null} confirmTimeoutMs={20} />);
    const trigger = screen.getByRole("button", { name: "Reboot…" });
    fireEvent.click(trigger);
    expect(screen.getByRole("group")).toBeTruthy();
    expect(document.activeElement).not.toBe(trigger);
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("is disabled, with no way to confirm, when blocked", () => {
    renderWithGateway(<ActionButton command={reboot} reason="The gateway is in read-only mode." />);
    expect((screen.getByRole("button", { name: "Reboot…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("non-destructive actions send at once, with an optional value", async () => {
    const delta = command("cp750.ctrl.fader_delta", {
      schema: { type: "integer", minimum: -100, maximum: 100 },
    });
    const { gateway } = renderWithGateway(<ActionButton command={delta} reason={null} />);
    fireEvent.change(screen.getByLabelText("Fader delta value"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Fader delta" }));
    await waitFor(() => expect(gateway.paramRequests("POST").length).toBe(1));
    expect(gateway.paramRequests("POST")[0]?.body).toEqual({ value: -5 });
  });
});
