export function sandboxListenConfig(env: NodeJS.ProcessEnv = process.env): { hostname: string; port: number } {
  const requestedPort = Number(env.PORT ?? env.SANDBOX_PORT ?? 4010);
  return {
    hostname: env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1",
    port: Number.isFinite(requestedPort) && requestedPort > 0 ? Math.trunc(requestedPort) : 4010,
  };
}
