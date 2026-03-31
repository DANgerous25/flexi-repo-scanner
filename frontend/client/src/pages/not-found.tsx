import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <AlertTriangle className="w-10 h-10 text-muted-foreground mb-4" />
      <h1 className="text-lg font-semibold text-foreground mb-1">Page Not Found</h1>
      <p className="text-sm text-muted-foreground mb-4">The page you're looking for doesn't exist.</p>
      <Link href="/">
        <Button variant="outline" size="sm" className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Button>
      </Link>
    </div>
  );
}
