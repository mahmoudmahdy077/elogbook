'use client';

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

export default function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center mb-8 gap-0">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                i < currentStep
                  ? 'bg-primary text-white'
                  : i === currentStep
                    ? 'bg-primary text-white ring-4 ring-primary-glow'
                    : 'bg-neutral-dark border border-border text-neutral-light'
              }`}
              role="status"
              aria-label={`${label}${i < currentStep ? ' (completed)' : i === currentStep ? ' (current)' : ''}`}
            >
              {i < currentStep ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M11.5 3.5L5.5 9.5L2.5 6.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span aria-hidden="true">{i + 1}</span>
              )}
            </div>
            <span
              className={`text-xs mt-1.5 font-medium ${
                i <= currentStep ? 'text-primary' : 'text-neutral-light/50'
              }`}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`w-8 sm:w-16 h-0.5 mx-1 mt-[-1rem] transition-all duration-300 ${
                i < currentStep ? 'bg-primary' : 'bg-border'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}