-- Migration 00064: Add onboarding flag to profiles table

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- Update handle_new_user trigger to set onboarding_completed = false
-- (trigger function already exists, just update the INSERT statement)
-- Note: This assumes the trigger calls a function that can be modified separately