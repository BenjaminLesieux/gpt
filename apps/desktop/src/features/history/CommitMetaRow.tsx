import type { ReactNode } from "react";

interface CommitMetaRowProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}

export function CommitMetaRow({ icon, label, children }: CommitMetaRowProps) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground [&>svg]:size-3">
        {icon}
        {label}
      </dt>
      <dd className="text-xs">{children}</dd>
    </>
  );
}
