-- 20260826200000_evaluation_form_status_guard.sql
-- SEC-004 / backlog #11: evaluation_forms had no status state machine.
-- Verified live (supervisor session): acknowledged -> completed PATCH
-- returned 204 — a signed-off evaluation could be silently rewritten,
-- defeating the acknowledgement attestation. completed -> pending also
-- succeeded (backwards transition).
--
-- State machine (medical-eval semantics, matches case_entries pattern):
--   pending    -> completed                       (evaluator submits)
--   completed  -> acknowledged                    (subject attests)
--   completed  -> completed                       (score corrections pre-ack)
--   pending    -> pending                         (draft edits)
--   acknowledged -> immutable for content edits   (see below)
--   No backwards transitions (completed/ack -> pending, ack -> completed).
--
-- Content immutability: once acknowledged, ANY change to scores/feedback/
-- ratings is rejected for everyone (supervisors included) — attestation
-- integrity outranks admin convenience; correction path = new evaluation.
--
-- INSERT guard mirrors SEC-002: forms may not be inserted as
-- 'acknowledged' (subjects must get the chance to see them) or with
-- invented status values. 'completed' insert is allowed (evaluator
-- submits directly) — consistent with existing UI flow.

CREATE OR REPLACE FUNCTION public.enforce_evaluation_form_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('pending', 'completed') THEN
      RAISE EXCEPTION 'SEC-004: evaluation forms must be inserted as pending or completed (got %)', NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status = 'acknowledged' THEN
    IF NEW.status IS DISTINCT FROM 'acknowledged' THEN
      RAISE EXCEPTION 'SEC-004: acknowledged evaluation is immutable (status % -> %)', OLD.status, NEW.status;
    END IF;
    IF NEW.ratings IS DISTINCT FROM OLD.ratings
       OR NEW.overall_score IS DISTINCT FROM OLD.overall_score
       OR NEW.feedback IS DISTINCT FROM OLD.feedback
       OR NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN
      RAISE EXCEPTION 'SEC-004: acknowledged evaluation content is immutable — file a new evaluation instead';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status = 'completed')
      OR (OLD.status = 'completed' AND NEW.status = 'acknowledged')
      OR (OLD.status = NEW.status)
    ) THEN
      RAISE EXCEPTION 'SEC-004: invalid evaluation status transition % -> % (legal: pending->completed->acknowledged)', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eval_form_status ON public.evaluation_forms;
CREATE TRIGGER trg_eval_form_status
  BEFORE INSERT OR UPDATE ON public.evaluation_forms
  FOR EACH ROW
  EXECUTE FUNCTION enforce_evaluation_form_status();

COMMENT ON FUNCTION enforce_evaluation_form_status() IS
  'SEC-004: evaluation_forms status state machine (pending->completed->acknowledged) + acknowledged-content immutability. Supersedes open-design-question backlog #11.';
