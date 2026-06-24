'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { PendingCaseCard } from './PendingCaseCard';
import { itemVariants, itemTransition } from './animations';
import { PendingEntry } from './useApprovalsData';

interface PendingCaseListProps {
  entries: PendingEntry[];
  tenantSlug: string;
}

export function PendingCaseList({ entries, tenantSlug }: PendingCaseListProps) {
  return (
    <div className="space-y-4">
      <AnimatePresence>
        {entries.map((entry, index) => (
          <motion.div
            key={entry.id}
            variants={itemVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={itemTransition}
            custom={index}
          >
            <PendingCaseCard entry={entry} tenantSlug={tenantSlug} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}