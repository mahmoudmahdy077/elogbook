'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface RequirementCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  installed_version?: string;
  required_version?: string;
}

const STEPS = [
  'Welcome',
  'Requirements',
  'Supabase Config',
  'Deploy Supabase',
  'Migrations',
  'Admin Account',
  'Domain & SSL',
  'Complete',
];

export default function SetupPage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [requirements, setRequirements] = useState<RequirementCheck[]>([]);
  const [requirementsReady, setRequirementsReady] = useState(false);

  const [installPath, setInstallPath] = useState('/opt/supabase');
  const [postgresPassword, setPostgresPassword] = useState('');
  const [postgresDb, setPostgresDb] = useState('supabase');
  const [siteUrl, setSiteUrl] = useState('http://localhost:3000');

  const [, setDeployProgress] = useState<string[]>([]);

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminFullName, setAdminFullName] = useState('');

  const [domain, setDomain] = useState('');

  useEffect(() => {
    if (step === 1) {
      fetch('/api/setup/check-requirements')
        .then(r => r.json())
        .then(data => {
          setRequirements(data.checks);
          setRequirementsReady(data.ready);
        })
        .catch(err => setError(err.message));
    }
  }, [step]);

  const handleCheckRequirements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/setup/check-requirements');
      const data = await res.json();
      setRequirements(data.checks);
      setRequirementsReady(data.ready);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check requirements');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDeploySupabase = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDeployProgress(['Generating secrets...']);

    try {
      const res = await fetch('/api/setup/deploy-supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installPath, postgresPassword, postgresDb, siteUrl }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setDeployProgress(prev => [...prev, 'Supabase deployed successfully']);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setLoading(false);
    }
  }, [installPath, postgresPassword, postgresDb, siteUrl]);

  const handleRunMigrations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/setup/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateAdmin = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/setup/create-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword, fullName: adminFullName }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep(6);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create admin');
    } finally {
      setLoading(false);
    }
  }, [adminEmail, adminPassword, adminFullName]);

  const handleConfigureDomain = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/setup/configure-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep(7);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Domain config failed');
    } finally {
      setLoading(false);
    }
  }, [domain]);

  const handleComplete = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/setup/complete', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setTimeout(() => { window.location.href = '/'; }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete setup');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="panel p-6 sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-1 mb-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-muted">
            Step {step + 1} of {STEPS.length}
          </span>
          <span className="text-xs font-medium text-text-muted">
            {STEPS[step]}
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="step-0" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h1 className="text-2xl font-bold mb-4">Welcome to E-Logbook Setup</h1>
            <p className="text-text-muted mb-6">This wizard will guide you through installing E-Logbook with a self-hosted Supabase backend. No terminal access required.</p>
            <button onClick={() => setStep(1)} className="px-6 py-2 rounded-lg bg-primary text-white">Start Setup</button>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="step-1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h2 className="text-xl font-bold mb-4">Server Requirements</h2>
            <div className="space-y-2 mb-6">
              {requirements.map((check) => (
                <div key={check.name} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <span>{check.name}</span>
                  <span className={`text-sm ${check.status === 'pass' ? 'text-success' : check.status === 'fail' ? 'text-danger' : 'text-warning'}`}>
                    {check.message}
                  </span>
                </div>
              ))}
            </div>
            {error && <p className="text-danger text-sm mb-4">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleCheckRequirements} disabled={loading} className="px-4 py-2 rounded-lg border border-border">Re-check</button>
              <button onClick={() => setStep(2)} disabled={!requirementsReady} className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">Continue</button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h2 className="text-xl font-bold mb-4">Supabase Configuration</h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs mb-1">Install Path</label>
                <input value={installPath} onChange={e => setInstallPath(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" />
              </div>
              <div>
                <label className="block text-xs mb-1">Database Password</label>
                <input type="password" value={postgresPassword} onChange={e => setPostgresPassword(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" placeholder="Min 12 characters" />
              </div>
              <div>
                <label className="block text-xs mb-1">Database Name</label>
                <input value={postgresDb} onChange={e => setPostgresDb(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" />
              </div>
              <div>
                <label className="block text-xs mb-1">Site URL</label>
                <input value={siteUrl} onChange={e => setSiteUrl(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" />
              </div>
            </div>
            {error && <p className="text-danger text-sm mb-4">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg border border-border">Back</button>
              <button onClick={handleDeploySupabase} disabled={loading || !postgresPassword} className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
                {loading ? 'Deploying...' : 'Deploy Supabase'}
              </button>
            </div>
          </motion.div>
        )}

        {step === 4 && (
          <motion.div key="step-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h2 className="text-xl font-bold mb-4">Database Migrations</h2>
            <p className="text-text-muted mb-4">Running database migrations to set up tables, policies, and seed data.</p>
            {error && <p className="text-danger text-sm mb-4">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg border border-border">Back</button>
              <button onClick={handleRunMigrations} disabled={loading} className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
                {loading ? 'Running...' : 'Run Migrations'}
              </button>
            </div>
          </motion.div>
        )}

        {step === 5 && (
          <motion.div key="step-5" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h2 className="text-xl font-bold mb-4">Create Admin Account</h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs mb-1">Full Name</label>
                <input value={adminFullName} onChange={e => setAdminFullName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" />
              </div>
              <div>
                <label className="block text-xs mb-1">Email</label>
                <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" />
              </div>
              <div>
                <label className="block text-xs mb-1">Password</label>
                <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" />
              </div>
            </div>
            {error && <p className="text-danger text-sm mb-4">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(4)} className="px-4 py-2 rounded-lg border border-border">Back</button>
              <button onClick={handleCreateAdmin} disabled={loading || !adminEmail || !adminPassword || !adminFullName} className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
                {loading ? 'Creating...' : 'Create Admin'}
              </button>
            </div>
          </motion.div>
        )}

        {step === 6 && (
          <motion.div key="step-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h2 className="text-xl font-bold mb-4">Domain & SSL</h2>
            <p className="text-text-muted mb-4">Enter your domain name to configure automatic HTTPS via Caddy.</p>
            <div className="mb-6">
              <label className="block text-xs mb-1">Domain Name</label>
              <input value={domain} onChange={e => setDomain(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" placeholder="elogbook.example.com" />
            </div>
            {error && <p className="text-danger text-sm mb-4">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(5)} className="px-4 py-2 rounded-lg border border-border">Back</button>
              <button onClick={handleConfigureDomain} disabled={loading || !domain} className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
                {loading ? 'Configuring...' : 'Configure Domain'}
              </button>
            </div>
          </motion.div>
        )}

        {step === 7 && (
          <motion.div key="step-7" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h2 className="text-xl font-bold mb-4">Setup Complete</h2>
            <p className="text-text-muted mb-4">E-Logbook has been installed successfully. The application will restart in normal mode.</p>
            {error && <p className="text-danger text-sm mb-4">{error}</p>}
            <button onClick={handleComplete} disabled={loading} className="px-6 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
              {loading ? 'Finishing...' : 'Go to Dashboard'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
