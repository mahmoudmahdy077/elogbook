import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PhiFields } from '../PhiFields';

const PROPS = {
  mrnMasked: '***-**-8877',
  dobMasked: '****-**-02',
  entryId: 'case-1-uuid',
  tenantSlug: 'tenant-a',
  hasPhi: true,
};

describe('PhiFields', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows only masked values before reveal', () => {
    render(<PhiFields {...PROPS} />);
    expect(screen.getByText('***-**-8877')).toBeInTheDocument();
    expect(screen.getByText('****-**-02')).toBeInTheDocument();
    expect(screen.queryByText('MRN-998877')).not.toBeInTheDocument();
  });

  it('hides the Reveal button when there is no PHI', () => {
    render(<PhiFields {...PROPS} hasPhi={false} />);
    expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
  });

  it('fetches the audit-logged endpoint and shows full values after reveal', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ mrn: 'MRN-998877', dob: '1990-01-02', revealed: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<PhiFields {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    await waitFor(() => {
      expect(screen.getByText('MRN-998877')).toBeInTheDocument();
    });
    expect(screen.getByText('1990-01-02')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tenant-a/cases/case-1-uuid/phi-reveal',
      { method: 'POST' }
    );
    expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
  });

  it('keeps masked values and shows an error when the endpoint fails', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"Failed"}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<PhiFields {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not reveal/i)).toBeInTheDocument();
    });
    expect(screen.getByText('***-**-8877')).toBeInTheDocument();
    expect(screen.queryByText('MRN-998877')).not.toBeInTheDocument();
  });
});
