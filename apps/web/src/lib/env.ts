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

const REQUIRED_SANDBOX_TOKENS = ["SANDBOX_READ_TOKEN", "SANDBOX_WRITE_TOKEN", "SANDBOX_ADMIN_TOKEN"] as const;

function missingOrPlaceholder(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized.includes("replace-") || normalized.includes("your-") || normalized.includes("changeme") || normalized.includes("placeholder");
}

function parsedUrl(value: string | undefined): URL | null {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

/** Safe production preflight. Returns names and guidance only; never returns secret values. */
export function validateProductionEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const errors: string[] = [];
  const appUrl = parsedUrl(env.NEXT_PUBLIC_APP_URL);
  if (!appUrl || appUrl.protocol !== "https:") errors.push("NEXT_PUBLIC_APP_URL must use https in production.");

  const origins = (env.PROOFWORK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!env.NEXT_PUBLIC_APP_URL || !origins.includes(env.NEXT_PUBLIC_APP_URL)) {
    errors.push("PROOFWORK_ALLOWED_ORIGINS must include NEXT_PUBLIC_APP_URL.");
  }

  const supabaseUrl = parsedUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!supabaseUrl || supabaseUrl.protocol !== "https:") errors.push("NEXT_PUBLIC_SUPABASE_URL must use https in production.");
  if (missingOrPlaceholder(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or still a placeholder.");
  }
  const isProductionAlias = env.VERCEL_ENV !== "preview";
  if (isProductionAlias && env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED !== "true") {
    errors.push("NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED must be true in production.");
  }

  const databaseUrl = parsedUrl(env.DATABASE_URL);
  if (env.DATABASE_RUNTIME !== "serverless") errors.push("DATABASE_RUNTIME must be serverless for the Vercel web deployment.");
  if (missingOrPlaceholder(env.DATABASE_URL)) {
    errors.push("DATABASE_URL is missing or still a placeholder.");
  } else if (!databaseUrl || !["postgres:", "postgresql:"].includes(databaseUrl.protocol) || databaseUrl.port !== "6543") {
    errors.push("DATABASE_URL must use the Supabase transaction pooler on port 6543 in serverless mode.");
  }
  if (!env.DEMO_COOKIE_SECRET || env.DEMO_COOKIE_SECRET.length < 32 || missingOrPlaceholder(env.DEMO_COOKIE_SECRET)) {
    errors.push("DEMO_COOKIE_SECRET must contain at least 32 characters.");
  }
  const sandboxUrl = parsedUrl(env.SANDBOX_API_URL);
  if (!sandboxUrl || sandboxUrl.protocol !== "https:") errors.push("SANDBOX_API_URL must use https in production.");
  for (const key of REQUIRED_SANDBOX_TOKENS) {
    if (missingOrPlaceholder(env[key])) errors.push(`${key} is missing or still a placeholder.`);
  }
  return errors;
}

export function allowedOrigins(): string[] {
  const configured = (process.env.PROOFWORK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return configured.length ? configured : [publicEnv.appUrl];
}
