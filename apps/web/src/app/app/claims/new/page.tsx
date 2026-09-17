import { Suspense } from "react";
import { SubmitReportPage } from "@/features/claims/submit-report-page";

export const metadata = { title: "Submit report" };

export default function Page() {
  return (
    <Suspense>
      <SubmitReportPage />
    </Suspense>
  );
}
