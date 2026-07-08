'use client';

import { motion } from 'framer-motion';

interface TourItem {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const TOUR_ITEMS: TourItem[] = [
  {
    icon: (
      <svg className="w-6 h-6 text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5zM4.75 10.75a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 4.25a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" clipRule="evenodd" />
      </svg>
    ),
    title: 'Log Cases',
    description: 'Quickly record clinical cases with specialty-specific templates. Track procedures, diagnoses, and patient encounters.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-[#34C759]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
      </svg>
    ),
    title: 'Track Milestones',
    description: 'Monitor your progress against ACGME milestones and EPA competencies with an interactive matrix.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-[#FF9500]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
        <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
      </svg>
    ),
    title: 'Set Goals',
    description: 'Define program goals with target case counts. Track your progress and get notified when you\'re falling behind.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-[#AF52DE]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" clipRule="evenodd" />
      </svg>
    ),
    title: 'View Reports',
    description: 'Generate detailed analytics and reports on case volume, specialty distribution, and supervisor workload.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-[#FF3B30]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10.362 1.093a.75.75 0 00-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925zM18 6.443l-7.25 4v8.25l6.862-3.786A.75.75 0 0018 14.25V6.443zm-8.75 12.25v-8.25l-7.25-4v7.807a.75.75 0 00.388.657l6.862 3.786z" clipRule="evenodd" />
      </svg>
    ),
    title: 'Supervisor Approvals',
    description: 'Submit cases for supervisor review. Track approval status and receive feedback on your entries.',
  },
];

interface StepTourProps {
  onComplete: () => void;
}

export default function StepTour({ onComplete }: StepTourProps) {
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
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">
          Quick Tour
        </h2>
        <p className="text-text-muted mt-2 text-sm max-w-md mx-auto">
          Here&apos;s what you can do with Elogbook. You&apos;ll find all of these in the sidebar.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {TOUR_ITEMS.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.3 }}
            className="flex gap-3 p-4 rounded-xl bg-white dark:bg-neutral-dark border border-border"
          >
            <div className="w-10 h-10 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center flex-shrink-0">
              {item.icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">{item.title}</h3>
              <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{item.description}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onComplete}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Got it, continue
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
