import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface TabViewerErrorStateProps {
  message?: string;
}

export function TabViewerErrorState({ message }: TabViewerErrorStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Alert variant="destructive" className="max-w-md">
        <AlertTriangle aria-hidden />
        <AlertTitle>Failed to load</AlertTitle>
        {message && <AlertDescription className="font-mono">{message}</AlertDescription>}
      </Alert>
    </div>
  );
}
