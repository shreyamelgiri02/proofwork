import { TaskDetailPage } from "@/features/tasks/task-detail-page";

export const metadata = { title: "Task evidence" };

export default async function Page({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <TaskDetailPage taskId={taskId} />;
}
