// apps/web/app/platform/email/page.tsx
import { createServiceRoleClient } from '@/lib/supabase/admin';
import TemplateEditor from './TemplateEditor';
import TestSendForm from './TestSendForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PlatformEmailPage() {
  const admin = createServiceRoleClient();
  const [{ count: pending }, { data: logs }] = await Promise.all([
    admin.from('email_queue').select('id', { count: 'exact', head: true }).in('status', ['pending', 'retry']),
    admin.from('email_logs').select('id,template_key,provider,status,created_at').order('created_at', { ascending: false }).limit(20),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Email operations</h1>
      <p className="text-sm text-text-muted mb-6">{pending ?? 0} queued. Resend primary + SMTP fallback.</p>
      <div className="rounded-14 border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-divider text-left text-text-muted"><th className="px-4 py-3">Template</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">At</th></tr></thead>
          <tbody>{((logs as { id: string; template_key: string; provider: string; status: string; created_at: string }[] | null) ?? []).map((l) => (<tr key={l.id} className="border-b border-divider last:border-0"><td className="px-4 py-3 font-mono text-xs">{l.template_key}</td><td className="px-4 py-3">{l.provider}</td><td className="px-4 py-3">{l.status}</td><td className="px-4 py-3 text-text-muted">{new Date(l.created_at).toLocaleString()}</td></tr>))}</tbody>
        </table>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <TemplateEditor />
        <TestSendForm />
      </div>
    </div>
  );
}
