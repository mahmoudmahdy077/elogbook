'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import StepProfile from '@/components/onboarding/StepProfile';
import StepSpecialty from '@/components/onboarding/StepSpecialty';
import StepTour from '@/components/onboarding/StepTour';

const STEPS = ['Profile', 'Specialty', 'Tour', 'First Case', 'Goals'];

interface OnboardingWizardProps {
  tenantSlug: string;
  profileId: string;
  tenantId: string;
  initialName: string;
  initialSpecialty: string | null;
}

export default function OnboardingWizard({
  tenantSlug,
  profileId,
  tenantId: _tenantId,
  initialName,
  initialSpecialty,
}: OnboardingWizardProps) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();

  const [currentStep, setCurrentStep] = useState(0);
  const [profileName, setProfileName] = useState(initialName);
  const [specialty, setSpecialty] = useState(initialSpecialty || '');
  const [submitting, setSubmitting] = useState(false);

  const saveProfile = useCallback(async (name: string, spec: string) => {
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name, specialty: spec, onboarding_completed: true })
      .eq('id', profileId);

    if (error) throw error;
  }, [supabase, profileId]);

  const handleProfileComplete = useCallback((name: string) => {
    setProfileName(name);
    setCurrentStep(1);
  }, []);

  const handleSpecialtyComplete = useCallback((spec: string) => {
    setSpecialty(spec);
    setCurrentStep(2);
  }, []);

  const handleTourComplete = useCallback(() => {
    setCurrentStep(3);
  }, []);

  const handleFirstCaseLater = useCallback(() => {
    setCurrentStep(4);
  }, []);

  const handleFirstCaseNow = useCallback(() => {
    // Redirect to new case page; onboarding will be finalized there
    router.push(`/${tenantSlug}/cases/new?onboarding=true`);
  }, [router, tenantSlug]);

  const handleSkipGoals = useCallback(async () => {
    setSubmitting(true);
    try {
      await saveProfile(profileName, specialty);
      toast.show('Onboarding complete! Welcome to Elogbook.', 'success');
      router.push(`/${tenantSlug}/dashboard`);
    } catch {
      toast.show('Failed to save profile. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [saveProfile, profileName, specialty, toast, router, tenantSlug]);

  const handleSetGoals = useCallback(async () => {
    setSubmitting(true);
    try {
      await saveProfile(profileName, specialty);
      toast.show('Onboarding complete!', 'success');
      router.push(`/${tenantSlug}/goals`);
    } catch {
      toast.show('Failed to save profile. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [saveProfile, profileName, specialty, toast, router, tenantSlug]);

  return (
    <div className="panel p-6 sm:p-8">
      {/* Step indicator */}
      <div className="mb-8">
        <div className="flex items-center gap-1 mb-2">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                i <= currentStep ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-muted">
            Step {currentStep + 1} of {STEPS.length}
          </span>
          <span className="text-xs font-medium text-text-muted">
            {STEPS[currentStep]}
          </span>
        </div>
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        {currentStep === 0 && (
          <StepProfile
            key="step-profile"
            initialName={profileName}
            onComplete={handleProfileComplete}
          />
        )}
        {currentStep === 1 && (
          <StepSpecialty
            key="step-specialty"
            initialSpecialty={specialty}
            onComplete={handleSpecialtyComplete}
          />
        )}
        {currentStep === 2 && (
          <StepTour key="step-tour" onComplete={handleTourComplete} />
        )}
        {currentStep === 3 && (
          <motion.div
            key="step-first-case"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-success" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-text-primary tracking-tight">
                Log your first case
              </h2>
              <p className="text-text-muted mt-2 text-sm max-w-md mx-auto">
                Start building your logbook by recording your first clinical case. Your specialty templates are ready to go.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleFirstCaseNow}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                Log First Case
              </button>
              <button
                onClick={handleFirstCaseLater}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-sm font-medium text-text-secondary hover:border-primary/30 hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Skip for now
              </button>
            </div>
          </motion.div>
        )}
        {currentStep === 4 && (
          <motion.div
            key="step-goals"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-warning" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10.362 1.093a.75.75 0 00-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925zM18 6.443l-7.25 4v8.25l6.862-3.786A.75.75 0 0018 14.25V6.443zm-8.75 12.25v-8.25l-7.25-4v7.807a.75.75 0 00.388.657l6.862 3.786z" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-text-primary tracking-tight">
                Set your goals
              </h2>
              <p className="text-text-muted mt-2 text-sm max-w-md mx-auto">
                Define program goals to track your progress. Set target case counts and deadlines for each specialty or procedure.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleSetGoals}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {submitting ? 'Finalizing...' : 'Set Up Goals'}
                {!submitting && (
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <button
                onClick={handleSkipGoals}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-sm font-medium text-text-secondary hover:border-primary/30 hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                Skip & Finish
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
