import { Suspense } from "react";
import { InsightsPage } from "@/features/insights/insights-page";

export const metadata = { title: "Insights" };

export default function Page() {
  return (
    <Suspense>
      <InsightsPage />
    </Suspense>
  );
}
