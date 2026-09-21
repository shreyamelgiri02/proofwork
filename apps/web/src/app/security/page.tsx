import { PublicLegalPage } from "@/components/public-legal-page";

export const metadata = { title: "Security" };

export default function SecurityPage() {
  return <PublicLegalPage label="Trust / Security" title="Security at Proofwork" intro="Proofwork is built so a claim cannot mark itself complete and a recovery action cannot exceed the authority recorded for the case." sections={[
    { title: "Identity and workspace isolation", body: <p>Supabase Auth validates user identity. Personal and Workspace Google accounts use the same OpenID Connect flow, while verified-email identity linking preserves an existing private workspace.</p> },
    { title: "Least-privilege services", body: <p>The web application and worker use a restricted application database role. The simulated billing service uses a separate role limited to its own schema. Migration credentials are not runtime credentials.</p> },
    { title: "Bounded writes", body: <p>Recovery is limited to one supported field change. A fresh precheck, policy gate, stable operation key, and independent post-write observation surround every dispatch.</p> },
    { title: "Auditability", body: <p>Requests, claims, evidence, verdict reasons, proposals, decisions, operations, and interventions produce append-only activity records with timestamps and correlation identifiers.</p> },
    { title: "Application protections", body: <p>State-changing browser requests are origin checked. Sensitive tokens are stored as hashes where applicable, provider errors are redacted, inputs are validated, and rate limits protect exposed endpoints.</p> },
    { title: "Reporting an issue", body: <p>Report a suspected vulnerability privately through the security contact published by the deployment owner. Do not include live credentials, customer data, or exploit details in a public issue.</p> },
  ]} />;
}
