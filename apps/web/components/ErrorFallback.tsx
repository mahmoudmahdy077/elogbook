export function ErrorFallback({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-8 bg-surface-solid rounded-xl">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-2">{title}</h2>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  );
}
