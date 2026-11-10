import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createFakeGateway, problem } from "../../../../../test/fake-gateway.ts";
import { renderWithGateway } from "../../../../../test/render.tsx";
import { INPUT_PARAM, InputSelector } from "./InputSelector.tsx";

describe("InputSelector", () => {
  test("offers the manifest's inputs and writes the chosen one", async () => {
    const { gateway } = renderWithGateway(<InputSelector />);
    const analog = await screen.findByRole("button", { name: /Analog/ });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Digital 1/ }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    fireEvent.click(analog);
    await waitFor(() => expect(analog.getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(gateway.values.get(INPUT_PARAM)).toBe("analog"));
  });

  test("shows a rejected switch as the input the processor kept", async () => {
    const gateway = createFakeGateway();
    gateway.intercept((r) =>
      r.method === "PUT"
        ? problem(422, "WRITE_REJECTED", { requested: "non_sync", actual: "dig_1", raw: "dig_1" })
        : undefined,
    );
    renderWithGateway(<InputSelector />, { gateway });
    fireEvent.click(await screen.findByRole("button", { name: /Non-sync/ }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The processor kept Digital 1",
    );
    expect(screen.getByRole("button", { name: /Digital 1/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
