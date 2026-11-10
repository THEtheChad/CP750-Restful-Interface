export const queryKeys = {
  device: ["device"] as const,
  commands: ["commands"] as const,
  params: ["param"] as const,
  param: (name: string) => ["param", name] as const,
};
