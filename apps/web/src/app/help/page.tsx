import Link from "next/link";
import { PublicLegalPage } from "@/components/public-legal-page";

export const metadata = { title: "Help" };

export default function HelpPage() {
  return <PublicLegalPage label="Support / Help" title="Help center" intro="Start with the evidence chain. Most questions are answered by the case header, source observation, verdict reason, and action docket." sections={[
    { title: "Getting started", body: <p>Create a workspace, choose a recovery policy, connect Proofwork Sandbox or a supported test source, then register the customer request before submitting an agent report.</p> },
    { title: "Google or email sign-in", body: <p>Use any personal or Workspace Google account when Google is available, or continue with email and password. Matching verified emails resolve to the same workspace.</p> },
    { title: "A case says Could not verify", body: <p>Proofwork does not infer success when a source is unavailable, stale, malformed, or inaccessible. Open the evidence record for the reason code, then recheck after restoring access.</p> },
    { title: "A recovery needs approval", body: <p>Open Approvals, compare the exact before and proposed values, and approve or reject before expiry. Proofwork performs another source read before any write.</p> },
    { title: "Demo and simulated billing", body: <p>Proofwork Sandbox contains isolated simulated data. Demo actions do not reach a real billing account, and demo workspaces expire automatically.</p> },
    { title: "Still need help", body: <p>Use the support channel published by your deployment owner and include the safe correlation reference shown in the interface. Never send a password, database URL, OAuth secret, or service token.</p> },
    { title: "Return to Proofwork", body: <p><Link href="/sign-in" className="font-semibold text-primary-ink hover:underline">Sign in to your workspace</Link> or <Link href="/" className="font-semibold text-primary-ink hover:underline">review the product overview</Link>.</p> },
  ]} />;
}
