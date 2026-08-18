'use client';

interface QuickAddFABProps {
  onClick: () => void;
}

export default function QuickAddFAB({ onClick }: QuickAddFABProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-50"
      aria-label="Quick add case"
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}
