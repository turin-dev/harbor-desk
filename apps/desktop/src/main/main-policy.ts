export function connectionOriginsFor(gatewayUrl: string | undefined): string[] {
  if (!gatewayUrl) return [];
  try {
    const origin = new URL(gatewayUrl).origin;
    return [origin, origin.replace(/^http/i, "ws")];
  } catch {
    return [];
  }
}

export function buildMainFrameCsp(connectOrigins: string[]): string {
  const connect = ["'self'", ...connectOrigins].join(" ");
  return (
    "default-src 'self'; base-uri 'self'; object-src 'none'; " +
    "frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src " +
    connect +
    "; font-src 'self' data:;"
  );
}

export function secureTokenKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function harborCallbackUrl(commandLine: string[]): string | undefined {
  return commandLine.find((argument) => argument.startsWith("harbor-desk://"));
}
