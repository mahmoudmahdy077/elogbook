import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-backdrop text-text-primary flex items-center justify-center p-4">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-heading font-bold mb-2">404</h1>
        <p className="text-text-muted mb-6">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
        <Link href="/login" className="inline-block px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors">
          Go to login
        </Link>
      </div>
    </div>
  );
}
