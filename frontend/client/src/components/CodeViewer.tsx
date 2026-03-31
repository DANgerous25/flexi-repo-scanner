import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface CodeViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  line?: number;
  content: string | null;
  loading?: boolean;
  error?: string;
}

export default function CodeViewer({
  open,
  onOpenChange,
  filePath,
  line,
  content,
  loading,
  error,
}: CodeViewerProps) {
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && content && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 100);
    }
  }, [open, content, line]);

  const lines = content?.split("\n") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 bg-[hsl(240,6%,6%)] border-border">
        <DialogHeader className="px-4 py-3 border-b border-border flex-shrink-0">
          <DialogTitle className="text-sm font-mono text-foreground flex items-center gap-2">
            <span className="truncate">{filePath}</span>
            {line && (
              <span className="text-xs text-muted-foreground flex-shrink-0">
                Line {line}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-red-400">{error}</div>
          ) : (
            <div className="text-xs font-mono leading-5">
              {lines.map((lineContent, i) => {
                const lineNum = i + 1;
                const isHighlighted = lineNum === line;
                return (
                  <div
                    key={i}
                    ref={isHighlighted ? highlightRef : undefined}
                    className={`flex ${
                      isHighlighted
                        ? "bg-amber-500/15 border-l-2 border-amber-400"
                        : "border-l-2 border-transparent hover:bg-muted/20"
                    }`}
                  >
                    <span className="w-12 flex-shrink-0 text-right pr-3 py-px select-none text-muted-foreground/50">
                      {lineNum}
                    </span>
                    <span className="flex-1 py-px pr-4 whitespace-pre text-foreground/90 overflow-x-auto">
                      {lineContent}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
