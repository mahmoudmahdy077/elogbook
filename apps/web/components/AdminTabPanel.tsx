'use client';

import { useState } from 'react';
import Link from 'next/link';
import TemplateEditor from '@/components/TemplateEditor';
import UserManager from '@/components/UserManager';
import UserTable from '@/components/UserTable';
import PaymentGatewayPanel from '@/components/PaymentGatewayPanel';
import CompetencyManager from '@/components/CompetencyManager';
import SubscriptionManager from '@/components/SubscriptionManager';

interface GatewayConfig {
  id: string;
  tenant_id: string;
  provider: string;
  publishable_key: string;
  has_secret_key: boolean;
  has_webhook_secret: boolean;
  endpoint_url: string | null;
  is_active: boolean;
}

interface AiConfigData {
  id: string;
  tenant_id: string;
  provider: string;
  model: string;
  endpoint_url: string | null;
  is_active: boolean;
  has_key: boolean;
}

interface AdminTabPanelProps {
  tenantSlug: string;
  tenantId: string;
  profileRole: string;
  templates: unknown[];
  users: unknown[];
  aiConfig: AiConfigData | null;
  paymentConfig: GatewayConfig | null;
  totalCases: number;
  pendingCases: number;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'templates', label: 'Case Templates' },
  { id: 'users', label: 'Users & Roles' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'payment', label: 'Payment Gateway' },
  { id: 'accreditation', label: 'Accreditation' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AdminTabPanel({
  tenantSlug,
  tenantId,
  profileRole,
  templates,
  users,
  paymentConfig,
  totalCases,
  pendingCases,
}: AdminTabPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors rounded-t-lg whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="panel p-5">
          <h2 className="text-lg font-heading font-semibold mb-2">Program Analytics</h2>
          <p className="text-sm text-text-muted/60 mb-4">
            View institution-wide completion rates, pending verifications, and specialty distribution.
          </p>
          <div className="flex gap-6 mb-4">
            <div>
              <p className="text-xs text-text-muted/50">Total Cases</p>
              <p className="text-2xl font-bold font-heading">{totalCases}</p>
            </div>
            <div>
              <p className="text-xs text-amber-400/60">Pending Verification</p>
              <p className="text-2xl font-bold font-heading text-amber-400">{pendingCases}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted/50">Residents</p>
              <p className="text-2xl font-bold font-heading">{((users ?? []) as unknown[]).length}</p>
            </div>
          </div>
          <Link
            href={`/${tenantSlug}/admin/overview`}
            className="inline-flex items-center rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Open Program Overview
          </Link>
        </div>
      )}

      {activeTab === 'templates' && (
        <div>
          <div className="mb-4">
            <Link
              href={`/${tenantSlug}/admin/templates`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm hover:opacity-90 transition-opacity"
            >
              Open Template Builder
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>
          <TemplateEditor tenantId={tenantId} templates={templates as never[]} />
        </div>
      )}

      {activeTab === 'users' && (
        <div>
          <div className="mb-4">
            <h3 className="font-semibold text-sm text-text-muted mb-2">Quick Invite (Legacy)</h3>
            <UserManager
              tenantId={tenantId}
              users={users as never[]}
              currentUserRole={profileRole}
            />
          </div>
          <div className="mt-6">
            <h3 className="font-semibold text-sm text-text-muted mb-2">User Management</h3>
            <UserTable tenantSlug={tenantSlug} />
          </div>
        </div>
      )}

      {activeTab === 'subscriptions' && (
        <SubscriptionManager tenantSlug={tenantSlug} />
      )}

      {activeTab === 'payment' && (
        <PaymentGatewayPanel tenantId={tenantId} config={paymentConfig} />
      )}

      {activeTab === 'accreditation' && (
        <CompetencyManager tenantId={tenantId} />
      )}
    </div>
  );
}
