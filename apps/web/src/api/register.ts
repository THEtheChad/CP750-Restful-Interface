/** Every query and mutation error is an `ApiError` (see `client.ts`). */
import type { ApiError } from "./problem.ts";

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: ApiError;
  }
}
