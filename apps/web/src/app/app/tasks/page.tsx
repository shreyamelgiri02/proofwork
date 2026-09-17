import { Suspense } from "react";
import { TasksPage } from "@/features/tasks/tasks-page";

export const metadata = { title: "Tasks" };

export default function Page() {
  return (
    <Suspense>
      <TasksPage />
    </Suspense>
  );
}
