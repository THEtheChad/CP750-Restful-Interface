import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createApi } from "../src/api/client.ts";
import { createTokenStore } from "../src/api/token-store.ts";
import { AppProviders, createQueryClient } from "../src/components/AppProviders/AppProviders.tsx";
import {
  createFakeEventSource,
  createFakeGateway,
  FakeEventSource,
  type FakeGateway,
} from "./fake-gateway.ts";

export interface RenderOptions {
  gateway?: FakeGateway;
  token?: string;
}

/** Renders `ui` inside the real providers, wired to a fake gateway and a fake `EventSource`. */
export function renderWithGateway(ui: ReactElement, options: RenderOptions = {}) {
  FakeEventSource.reset();
  const gateway = options.gateway ?? createFakeGateway();
  const tokens = createTokenStore(null);
  if (options.token) tokens.set(options.token);
  const api = createApi({ baseUrl: "http://localhost:2222", fetch: gateway.fetch, tokens });
  const queryClient = createQueryClient();
  const result = render(
    <AppProviders
      api={api}
      tokens={tokens}
      queryClient={queryClient}
      createEventSource={createFakeEventSource}
    >
      {ui}
    </AppProviders>,
  );
  return { ...result, gateway, queryClient, tokens, events: () => FakeEventSource.latest };
}
