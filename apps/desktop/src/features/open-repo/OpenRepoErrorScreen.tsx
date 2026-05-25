import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface OpenRepoErrorScreenProps {
  message: string;
  onRetry: () => void;
}

export function OpenRepoErrorScreen({ message, onRetry }: OpenRepoErrorScreenProps) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <div>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
