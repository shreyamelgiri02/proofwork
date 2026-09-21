import { PublicLegalPage } from "@/components/public-legal-page";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return <PublicLegalPage label="Legal / Terms" title="Terms of service" intro="These terms set the operating boundary for using Proofwork to verify reported work and apply narrowly authorized recovery actions." sections={[
    { title: "Using the service", body: <p>You must have authority to connect each source, register each request, review its evidence, and approve any recovery action. Keep account credentials and ingestion tokens confidential.</p> },
    { title: "Supported scope", body: <p>The initial supported workflow verifies subscription cancellation at the current paid-period end. Refunds, immediate cancellation, invoice changes, and other actions are outside this workflow.</p> },
    { title: "Evidence and decisions", body: <p>Proofwork presents source observations and deterministic verdicts to support operational decisions. You remain responsible for checking the record and deciding whether a proposed action is appropriate.</p> },
    { title: "Prohibited use", body: <p>Do not use the service to access systems without permission, bypass provider controls, submit deceptive evidence, interfere with other workspaces, or automate unlawful or harmful activity.</p> },
    { title: "Availability", body: <p>The service may be interrupted for maintenance, provider outages, or safety controls. Queued work is designed to resume, but uninterrupted availability is not guaranteed.</p> },
    { title: "Changes and contact", body: <p>Material terms changes should be published with an updated date. Questions must be directed to the support channel identified by the deployment owner.</p> },
  ]} />;
}
