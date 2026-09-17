import { redirect } from "next/navigation";

/** /app resolves to Tasks; the layout already sends unfinished workspaces to onboarding. */
export default function AppIndex() {
  redirect("/app/tasks");
}
