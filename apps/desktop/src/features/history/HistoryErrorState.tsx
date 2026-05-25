import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface HistoryErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function HistoryErrorState({ message, onRetry }: HistoryErrorStateProps) {
  return (
    <div className="px-4 py-4">
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>Load failed</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}
