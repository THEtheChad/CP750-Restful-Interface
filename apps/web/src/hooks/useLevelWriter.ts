import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useApi, useWriteParam } from "../api/hooks.ts";
import { type ApiError, asApiError } from "../api/problem.ts";
import { queryKeys } from "../api/query-keys.ts";
import type { ParamReading } from "../api/types.ts";
import { clampFader, FADER_PAGE, stepFader } from "../lib/fader.ts";
import { useLatestSender } from "./useLatestSender.ts";

/** `value` moved at most `max` away from `from`. */
export function capStep(from: number, value: number, max: number): number {
  return clampFader(Math.max(from - max, Math.min(from + max, value)));
}

export interface LevelWriter {
  /** The level being sent (a drag or ramp in progress), or `null` when idle. */
  draft: number | null;
  error: ApiError | null;
  /** Queue `value` (throttled, newest only, ramped one page per send). False if refused. */
  change: (value: number) => boolean;
  /** `change`, then send now. */
  commit: (value: number) => void;
  /** Send whatever is queued now (pointer or key release). */
  flush: () => void;
  /** Drop whatever is queued (a cancelled gesture); a send in flight still completes. */
  cancel: () => void;
  /** Re-read the processor, then step from its value. Calls queue up in order. */
  step: (displayDelta: number) => void;
}

/**
 * The write engine for any fader-unit param (the main fader, the fader presets), so every
 * surface that changes a level shares the same safety rails:
 *
 * - steps re-read the processor and step from what it holds, one at a time;
 * - writes are throttled (newest value only, one in flight);
 * - no single send moves more than one page (±1.0) from the last known level; bigger moves
 *   ramp there one page per send, each measured from what the previous send left (the cache
 *   holds the processor's answer, or the rollback, by the time the next send is computed);
 * - nothing is queued until the processor's level is known, so no send is ever uncapped;
 * - a failed send stops the ramp: the rest of the move is dropped, not retried.
 */
export function useLevelWriter(
  name: string,
  { throttleMs }: { throttleMs?: number } = {},
): LevelWriter {
  const api = useApi();
  const queryClient = useQueryClient();
  const write = useWriteParam(name);
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const steps = useRef<Promise<void>>(Promise.resolve());

  /** The level the processor last reported (or the optimistic one of a write in flight). */
  const known = () => {
    const value = queryClient.getQueryData<ParamReading>(queryKeys.param(name))?.value;
    return typeof value === "number" ? value : null;
  };

  const sender = useLatestSender<number>(
    async (value) => {
      // Never send uncapped: with no known level there is nothing to measure one page from.
      if (known() === null) {
        sender.cancel();
        setDraft(null);
        return;
      }
      try {
        await write.mutateAsync({ value });
        setError(null);
      } catch (e) {
        setError(asApiError(e));
        // Stop here: the operator sees the error and the level the processor kept.
        sender.cancel();
        setDraft(null);
      }
    },
    {
      onIdle: () => setDraft(null),
      // Backstop: no single send moves more than one page from the last known level.
      limit: (target) => {
        const from = known();
        // `change` never queues without a known level; if it was lost since, the send below drops it.
        return from === null ? target : capStep(from, target, FADER_PAGE);
      },
      ...(throttleMs !== undefined ? { intervalMs: throttleMs } : {}),
    },
  );

  /** Queues `value`; refused while the processor's level is unknown (no baseline to cap from). */
  const change = (value: number): boolean => {
    if (known() === null) return false;
    setDraft(value);
    sender.push(value);
    return true;
  };

  return {
    draft,
    error,
    change,
    commit: (value) => {
      if (change(value)) sender.flush();
    },
    flush: () => sender.flush(),
    cancel: () => {
      sender.cancel();
      setDraft(null);
    },
    step: (displayDelta) => {
      steps.current = steps.current.then(async () => {
        try {
          const fresh = await queryClient.fetchQuery({
            queryKey: queryKeys.param(name),
            queryFn: () => api.readParam(name),
            staleTime: 0,
          });
          if (typeof fresh.value !== "number") return;
          sender.cancel();
          setDraft(null);
          await write.mutateAsync({ value: stepFader(fresh.value, displayDelta) });
          setError(null);
        } catch (e) {
          setError(asApiError(e));
        }
      });
    },
  };
}
