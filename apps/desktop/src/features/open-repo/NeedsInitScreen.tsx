import type { RepoValidation } from "../../api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";

interface NeedsInitScreenProps {
  validation: RepoValidation;
  onConfirm: () => void;
  onCancel: () => void;
}

export function NeedsInitScreen({ validation, onConfirm, onCancel }: NeedsInitScreenProps) {
  const question = validation.isGitRepo
    ? "This folder is a git repository but hasn't been registered with gpt."
    : "This folder isn't a repository yet.";
  const action = validation.isGitRepo
    ? "Register it with gpt?"
    : "Initialize a new gpt repository here?";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{question}</CardTitle>
        <CardDescription>{action}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="max-w-full truncate font-mono text-xs text-muted-foreground">
          {validation.dir}
        </p>
      </CardContent>
      <CardFooter className="gap-3">
        <Button onClick={onConfirm}>Initialize</Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}
