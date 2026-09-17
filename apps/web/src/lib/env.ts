/** Environment helpers. Server-only values are never read in client components. */

export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  googleOAuthEnabled: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseKey && !publicEnv.supabaseKey.startsWith("replace-"));
}

export function isDatabaseReady(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function setupGaps(): string[] {
  const gaps: string[] = [];
  if (!isSupabaseConfigured()) gaps.push("Supabase Auth (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  if (!isDatabaseReady()) gaps.push("Application database (DATABASE_URL)");
  if (!process.env.SANDBOX_API_URL || !process.env.SANDBOX_READ_TOKEN) gaps.push("Local billing sandbox (SANDBOX_API_URL / tokens)");
  if (!process.env.DEMO_COOKIE_SECRET || process.env.DEMO_COOKIE_SECRET.startsWith("replace-")) gaps.push("Demo session secret (DEMO_COOKIE_SECRET)");
  return gaps;
}

export function allowedOrigins(): string[] {
  const configured = (process.env.PROOFWORK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return configured.length ? configured : [publicEnv.appUrl];
}
