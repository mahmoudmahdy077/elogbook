'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

interface StepProfileProps {
  initialName: string;
  onComplete: (name: string) => void;
}

export default function StepProfile({ initialName, onComplete }: StepProfileProps) {
  const [name, setName] = useState(initialName || '');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter your full name.');
      return;
    }
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    setError('');
    onComplete(trimmed);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">
          Welcome to Elogbook
        </h2>
        <p className="text-text-muted mt-2 text-sm max-w-md mx-auto">
          Let&apos;s get started. Please confirm your name so we can set up your profile correctly.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="full-name" className="block text-sm font-medium text-text-primary mb-1.5">
            Full Name
          </label>
          <input
            id="full-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="Dr. Jane Smith"
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-white dark:bg-neutral-dark text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-sm"
            autoFocus
          />
          {error && (
            <p className="mt-1.5 text-xs text-danger">{error}</p>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Continue
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </form>
    </motion.div>
  );
}
