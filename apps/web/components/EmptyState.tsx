'use client';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

export default function EmptyState({ icon, title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <div className="panel p-8 text-center space-y-3">
      {icon && (
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-neutral-dark border border-border mb-1">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-neutral-light/70">{title}</p>
      {description && (
        <p className="text-xs text-neutral-light/50 max-w-xs mx-auto">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center justify-center gap-3 pt-1">
          {action && (action.href ? (
            <a href={action.href} className="inline-flex px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              {action.label}
            </a>
          ) : (
            <button onClick={action.onClick} className="inline-flex px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              {action.label}
            </button>
          ))}
          {secondaryAction && (secondaryAction.href ? (
            <a href={secondaryAction.href} className="inline-flex px-4 py-2 rounded-lg border border-border text-sm font-medium text-neutral-light hover:border-primary hover:text-primary transition-colors">
              {secondaryAction.label}
            </a>
          ) : (
            <button onClick={secondaryAction.onClick} className="inline-flex px-4 py-2 rounded-lg border border-border text-sm font-medium text-neutral-light hover:border-primary hover:text-primary transition-colors">
              {secondaryAction.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
