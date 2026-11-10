/** Human labels for param names and enum values. */
const INPUT_LABELS: Record<string, string> = {
  analog: "Analog",
  dig_1: "Digital 1",
  dig_2: "Digital 2",
  dig_3: "Digital 3",
  dig_4: "Digital 4",
  last: "Last",
  mic: "Mic",
  non_sync: "Non-sync",
};

/** `"non_sync"` → `"Non sync"`; known input names get their usual label. */
export function humanize(token: string): string {
  const known = INPUT_LABELS[token];
  if (known) return known;
  const words = token.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The last segment of `cp750.ctrl.default_params`, humanized: `"Default params"`. */
export function shortLabel(name: string): string {
  return humanize(name.split(".").pop() ?? name);
}
