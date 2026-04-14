import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";

export function WorkspaceSurfaceEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex size-full items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <ConversationEmptyState
          icon={<Icon />}
          title={title}
          description={description}
        />
        {action}
      </div>
    </div>
  );
}
