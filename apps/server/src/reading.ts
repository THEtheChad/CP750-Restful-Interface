import type { CommandInfo, Cp750Session, ParamResult } from "@cp750/device";
import { faderToDb, normalizeParamName, type ParamUnit } from "@cp750/manifests";

/** Finds a command by canonical name or alias, case-insensitively. */
export function findCommand(session: Cp750Session, input: string): CommandInfo | undefined {
  const name = normalizeParamName(input);
  return session
    .commands()
    .find((c) => c.name === name || c.spec?.aliases?.some((a) => a.toLowerCase() === name));
}

export interface Reading {
  name: string;
  value: number | string;
  raw: string;
  unit?: ParamUnit;
  db?: number;
}

/** A read/write result as the API returns it: adds `unit`, and `db` for faders. */
export function toReading(session: Cp750Session, result: ParamResult): Reading {
  const unit = findCommand(session, result.name)?.spec?.unit;
  return {
    name: result.name,
    value: result.value,
    raw: result.raw,
    ...(unit ? { unit } : {}),
    ...(unit === "fader" && typeof result.value === "number"
      ? { db: faderToDb(result.value) }
      : {}),
  };
}
