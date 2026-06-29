import { describe, it, expect } from 'vitest';

// Pure helper that decides whether the form is in "new case" or "edit case"
// mode based on the route params, and extracts the target id used for the
// update call (server id if known, local id otherwise).
type EditCaseState = {
  mode: 'new' | 'edit';
  targetId: string | null;
};

function deriveEditCaseState(params: { editCaseId?: string | null }, serverId: string | null): EditCaseState {
  if (!params.editCaseId) {
    return { mode: 'new', targetId: null };
  }
  return { mode: 'edit', targetId: serverId ?? params.editCaseId };
}

describe('deriveEditCaseState', () => {
  it('returns "new" mode when no editCaseId is set', () => {
    expect(deriveEditCaseState({}, null)).toEqual({ mode: 'new', targetId: null });
    expect(deriveEditCaseState({ editCaseId: null }, null)).toEqual({ mode: 'new', targetId: null });
  });

  it('returns "edit" mode with the local id when no server id is known yet', () => {
    expect(deriveEditCaseState({ editCaseId: 'local-1' }, null)).toEqual({
      mode: 'edit',
      targetId: 'local-1',
    });
  });

  it('returns "edit" mode targeting the server id when one has been captured', () => {
    expect(deriveEditCaseState({ editCaseId: 'local-1' }, 'server-99')).toEqual({
      mode: 'edit',
      targetId: 'server-99',
    });
  });
});
