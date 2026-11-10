import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApi } from "./api/client.ts";
import { createTokenStore } from "./api/token-store.ts";
import { App } from "./components/App/App.tsx";
import { AppProviders, createQueryClient } from "./components/AppProviders/AppProviders.tsx";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

const tokens = createTokenStore();
const api = createApi({ tokens });

createRoot(root).render(
  <StrictMode>
    <AppProviders api={api} tokens={tokens} queryClient={createQueryClient()}>
      <App />
    </AppProviders>
  </StrictMode>,
);
