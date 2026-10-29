export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p role="status" className="py-16 text-center text-muted">{label}</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto my-10 max-w-md rounded-xl border border-red-500/40 bg-red-500/10 p-6 text-center">
      <p className="text-red-200">{message}</p>
      {onRetry && <button onClick={onRetry} className="mt-4 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink">Try again</button>}
    </div>
  );
}
