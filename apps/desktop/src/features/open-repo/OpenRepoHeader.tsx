export function OpenRepoHeader() {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
        <span className="inline-block size-[6px] bg-primary" />
        <span>Version 0.1</span>
      </div>
      <h1 className="font-sans text-[56px] font-bold leading-[0.9] tracking-[-0.03em] text-foreground">
        gp<span className="text-primary">t</span>
      </h1>
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Git · for · musicians
      </p>
    </header>
  );
}
