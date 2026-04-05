import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { AuthoringFileEntry } from "@/core/authoring";
import { cn } from "@/lib/utils";

function sortEntries(entries: AuthoringFileEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.is_dir !== right.is_dir) {
      return left.is_dir ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export function AuthoringFileTree({
  title,
  rootPath,
  entriesByDir,
  expandedDirs,
  selectedPath,
  onSelectFile,
  onToggleDirectory,
}: {
  title: string;
  rootPath: string;
  entriesByDir: Record<string, AuthoringFileEntry[]>;
  expandedDirs: Record<string, boolean>;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) {
  function renderDirectory(directoryPath: string, depth: number) {
    const entries = sortEntries(entriesByDir[directoryPath] ?? []);
    return entries.map((entry) => {
      const isExpanded = expandedDirs[entry.path] ?? false;
      return (
        <div key={entry.path}>
          {entry.is_dir ? (
            <button
              type="button"
              onClick={() => onToggleDirectory(entry.path)}
              className={cn(
                "hover:bg-muted/80 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                depth > 0 && "ml-2",
              )}
              style={{ paddingLeft: `${depth * 14 + 12}px` }}
            >
              {isExpanded ? (
                <ChevronDownIcon className="text-muted-foreground size-4" />
              ) : (
                <ChevronRightIcon className="text-muted-foreground size-4" />
              )}
              {isExpanded ? (
                <FolderOpenIcon className="size-4 text-amber-500" />
              ) : (
                <FolderIcon className="size-4 text-amber-500" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelectFile(entry.path)}
              className={cn(
                "hover:bg-muted/80 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                selectedPath === entry.path && "bg-muted text-foreground",
              )}
              style={{ paddingLeft: `${depth * 14 + 38}px` }}
            >
              <FileTextIcon className="text-muted-foreground size-4" />
              <span className="truncate">{entry.name}</span>
            </button>
          )}
          {entry.is_dir && isExpanded ? renderDirectory(entry.path, depth + 1) : null}
        </div>
      );
    });
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col rounded-3xl border">
      <div className="border-b px-4 py-4">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-muted-foreground mt-1 text-xs">{rootPath}</div>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 py-3">
        <div className="space-y-1">
          {renderDirectory(rootPath, 0)}
          {(entriesByDir[rootPath] ?? []).length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-sm">
              No files staged yet.
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
