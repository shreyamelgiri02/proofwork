"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<CircleAlert aria-hidden />}
        title="This page could not be displayed"
        description={
          <>
            Something went wrong while loading persisted data. Nothing was changed.
            {error.digest ? <span className="mt-1 block font-mono text-xs">Reference {error.digest}</span> : null}
          </>
        }
        action={
          <>
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="secondary">
              <Link href="/app/tasks">Go to tasks</Link>
            </Button>
          </>
        }
      />
    </Card>
  );
}
