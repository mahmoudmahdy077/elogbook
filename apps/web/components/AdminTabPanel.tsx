'use client';

import { useState } from 'react';
import Link from 'next/link';
import TemplateEditor from '@/components/TemplateEditor';
import UserManager from '@/components/UserManager';
import PaymentGatewayPanel from '@/components/PaymentGatewayPanel';
import CompetencyManager from '@/components/CompetencyManager';

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

interface AdminTabPanelProps {
  tenantSlug: string;
  tenantId: string;
  profileRole: string;
  templates: unknown[];
  users: unknown[];
  paymentConfig: GatewayConfig | null;
  totalCases: number;
  pendingCases: number;
}

// SSO and SCIM tabs hidden: pending complete SAML/OIDC/SCIM implementation
// See P1.4 in ENTERPRISE_TRANSFORMATION_PLAN.md
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'templates', label: 'Case Templates' },
  { id: 'users', label: 'Users & Roles' },
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
      <div className="flex gap-1 border-b border-border mb-6" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors rounded-t-lg ${
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
        <TemplateEditor tenantId={tenantId} templates={templates as never[]} />
      )}

      {activeTab === 'users' && (
        <UserManager
          tenantId={tenantId}
          users={users as never[]}
          currentUserRole={profileRole}
        />
      )}

      {activeTab === 'payment' && (
        <PaymentGatewayPanel tenantId={tenantId} config={paymentConfig} />
      )}

      {activeTab === 'accreditation' && (
        <CompetencyManager tenantId={tenantId} />
      )}

      {/* SSO and SCIM tabs removed pending complete implementation (P1.4) */}
    </div>
  );
}
