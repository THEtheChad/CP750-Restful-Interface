import { describe, expect, test } from "bun:test";
import { createLatestSender, type Scheduler } from "./latest-sender.ts";

/** A manual clock: `advance(ms)` runs due timers in order. */
function fakeScheduler() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  const scheduler: Scheduler = {
    now: () => now,
    schedule(fn, ms) {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
  };
  return {
    scheduler,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.fn();
        await settle();
      }
      now = end;
      await settle();
    },
    get pending() {
      return timers.length;
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A `send` whose calls resolve only when the test says so. */
function controlledSend() {
  const sent: number[] = [];
  const resolvers: (() => void)[] = [];
  return {
    sent,
    send: (value: number) => {
      sent.push(value);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    async resolveNext() {
      resolvers.shift()?.();
      await settle();
    },
  };
}

describe("latest-value sender (fader throttle)", () => {
  test("sends the first value at once, then at most one per interval, newest only", async () => {
    const clock = fakeScheduler();
    const io = controlledSend();
    const sender = createLatestSender({
      send: io.send,
      intervalMs: 150,
      scheduler: clock.scheduler,
    });

    sender.push(70);
    expect(io.sent).toEqual([70]);
    await io.resolveNext();

    // A drag: many values inside one interval collapse to the newest.
    for (const v of [71, 72, 73, 74, 75]) sender.push(v);
    expect(io.sent).toEqual([70]);
    await clock.advance(150);
    expect(io.sent).toEqual([70, 75]);
  });

  test("never queues a backlog behind a slow request", async () => {
    const clock = fakeScheduler();
    const io = controlledSend();
    const sender = createLatestSender({
      send: io.send,
      intervalMs: 150,
      scheduler: clock.scheduler,
    });

    sender.push(1);
    for (let v = 2; v <= 50; v++) {
      sender.push(v);
      await clock.advance(20);
    }
    // The first request is still in flight after ~1 s, so nothing else was sent.
    expect(io.sent).toEqual([1]);
    await io.resolveNext();
    expect(io.sent).toEqual([1, 50]);
    await io.resolveNext();
    expect(sender.busy).toBe(false);
  });

  test("flush commits the final value without waiting for the interval", async () => {
    const clock = fakeScheduler();
    const io = controlledSend();
    let idle = 0;
    const sender = createLatestSender({
      send: io.send,
      intervalMs: 150,
      scheduler: clock.scheduler,
      onIdle: () => idle++,
    });

    sender.push(60);
    await io.resolveNext();
    sender.push(61);
    sender.push(62);
    expect(io.sent).toEqual([60]);
    sender.flush();
    expect(io.sent).toEqual([60, 62]);
    expect(clock.pending).toBe(0);
    await io.resolveNext();
    expect(idle).toBe(2);
  });

  test("a failing send does not stop later values", async () => {
    const clock = fakeScheduler();
    const sent: number[] = [];
    const sender = createLatestSender({
      send: async (v: number) => {
        sent.push(v);
        if (v === 1) throw new Error("boom");
      },
      intervalMs: 150,
      scheduler: clock.scheduler,
    });
    sender.push(1);
    await settle();
    sender.push(2);
    await clock.advance(150);
    expect(sent).toEqual([1, 2]);
  });

  test("cancel drops the waiting value", async () => {
    const clock = fakeScheduler();
    const io = controlledSend();
    const sender = createLatestSender({
      send: io.send,
      intervalMs: 150,
      scheduler: clock.scheduler,
    });
    sender.push(1);
    sender.push(2);
    sender.cancel();
    await io.resolveNext();
    await clock.advance(500);
    expect(io.sent).toEqual([1]);
  });

  describe("limit (per-send delta cap)", () => {
    /** A device that follows every write, and a limit of ±10 from its value. */
    function ramp(initial: number, follows = true) {
      const clock = fakeScheduler();
      let device = initial;
      const sent: number[] = [];
      let idle = 0;
      const sender = createLatestSender({
        send: async (v: number) => {
          sent.push(v);
          if (follows) device = v;
        },
        intervalMs: 150,
        scheduler: clock.scheduler,
        limit: (target) => Math.max(device - 10, Math.min(device + 10, target)),
        onIdle: () => idle++,
      });
      return { clock, sender, sent, idle: () => idle, device: () => device };
    }

    test("a big jump is sent as a ramp of capped steps, throttled", async () => {
      const r = ramp(70);
      r.sender.push(100);
      r.sender.flush();
      await settle();
      expect(r.sent).toEqual([80]);
      await r.clock.advance(150);
      expect(r.sent).toEqual([80, 90]);
      await r.clock.advance(150);
      expect(r.sent).toEqual([80, 90, 100]);
      await r.clock.advance(1_000);
      expect(r.sent).toEqual([80, 90, 100]);
      expect(r.idle()).toBe(1);
    });

    test("a newer target replaces the rest of the ramp", async () => {
      const r = ramp(70);
      r.sender.push(100);
      await settle();
      r.sender.push(75);
      await r.clock.advance(150);
      expect(r.sent).toEqual([80, 75]);
    });

    test("gives up when the device does not follow a capped step", async () => {
      const r = ramp(70, false);
      r.sender.push(100);
      await settle();
      await r.clock.advance(1_000);
      expect(r.sent).toEqual([80]);
      expect(r.sender.busy).toBe(false);
      expect(r.idle()).toBe(1);
      // A new target from the operator starts a new ramp.
      r.sender.push(100);
      await settle();
      expect(r.sent).toEqual([80, 80]);
    });
  });
});
