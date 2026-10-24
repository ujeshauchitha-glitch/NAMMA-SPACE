type StatusPillProps = {
  tone: 'good' | 'warn' | 'muted' | 'accent';
  children: string;
};

export function StatusPill({ tone, children }: StatusPillProps) {
  return <span className={`status-pill status-pill--${tone}`}><span className="status-dot" />{children}</span>;
}
