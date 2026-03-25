import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

interface TraceFiltersProps {
  userId: string;
  agentName: string;
  threadId: string;
  onUserIdChange: (v: string) => void;
  onAgentNameChange: (v: string) => void;
  onThreadIdChange: (v: string) => void;
}

export function TraceFilters({
  userId,
  agentName,
  threadId,
  onUserIdChange,
  onAgentNameChange,
  onThreadIdChange,
}: TraceFiltersProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("User ID")}
          value={userId}
          onChange={(e) => onUserIdChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("Agent Name")}
          value={agentName}
          onChange={(e) => onAgentNameChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("Thread ID")}
          value={threadId}
          onChange={(e) => onThreadIdChange(e.target.value)}
          className="pl-9"
        />
      </div>
    </div>
  );
}
