-- Migration 00067: Add template_favorites table for per-user starred templates

CREATE TABLE template_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES case_templates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, template_id)
);

CREATE INDEX idx_template_favorites_template_id
  ON template_favorites(template_id);

ALTER TABLE template_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_favorites_select
  ON template_favorites FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY template_favorites_insert
  ON template_favorites FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY template_favorites_delete
  ON template_favorites FOR DELETE
  USING (user_id = auth.uid());

-- Down (rollback):
-- DROP TABLE IF EXISTS template_favorites;
