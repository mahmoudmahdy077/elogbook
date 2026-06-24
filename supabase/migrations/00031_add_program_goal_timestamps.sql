-- Migration 00031: Add timestamps to program_goals
ALTER TABLE program_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE program_goals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION set_program_goals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS set_program_goals_updated_at ON program_goals;
CREATE TRIGGER set_program_goals_updated_at
  BEFORE UPDATE ON program_goals
  FOR EACH ROW EXECUTE FUNCTION set_program_goals_updated_at();
