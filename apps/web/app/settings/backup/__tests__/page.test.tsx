import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The restore API takes an OPAQUE, operator-provisioned target id plus an
// explicit disposable-target confirmation. The page has to obtain that id from
// the server's target inventory, never invent one, and never fire a restore
// request when no target is provisioned (the API fails closed; the UI must not
// pretend otherwise).

const fetchMock = vi.hoisted(() => vi.fn());

vi.stubGlobal('fetch', fetchMock);

import BackupSettingsPage from '../page';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function calls(): FetchCall[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: String(init?.method ?? 'GET'),
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }));
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  };
}

const BACKUP = {
  backup_id: '2026-09-01T00-00-00-000Z',
  type: 'full',
  trigger: 'manual',
  created_at: '2026-09-01T00:00:00.000Z',
  size_bytes: 1024,
  contents: { 'database.sql.gz.enc': true },
  database_stats: {},
};

function mockInventory(restoreTargets: string[]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/backup/restore')) return jsonResponse(200, { restoreTargets });
    if (init?.method === 'POST') return jsonResponse(200, { success: true });
    return jsonResponse(200, { backups: [BACKUP] });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe('backup settings restore contract', () => {
  it('sends the opaque restoreTargetId and the disposable confirmation', async () => {
    mockInventory(['drill_1']);
    render(<BackupSettingsPage />);

    const restoreButton = await screen.findByRole('button', { name: /restore/i });
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(calls().some((call) => call.method === 'POST' && call.url.endsWith('/api/backup/restore'))).toBe(true);
    });

    const restoreCall = calls().find((call) => call.method === 'POST' && call.url.endsWith('/api/backup/restore'));
    expect(restoreCall?.body).toMatchObject({
      backupId: BACKUP.backup_id,
      restoreTargetId: 'drill_1',
      confirmDisposableTarget: true,
    });
    expect(restoreCall?.body).not.toHaveProperty('targetDatabase');
  });

  it('fails closed and sends no restore request when no target is provisioned', async () => {
    mockInventory([]);
    render(<BackupSettingsPage />);

    const restoreButton = await screen.findByRole('button', { name: /restore/i });
    fireEvent.click(restoreButton);

    expect(await screen.findByText(/no disposable restore target is provisioned/i)).toBeInTheDocument();
    expect(calls().some((call) => call.method === 'POST' && call.url.endsWith('/api/backup/restore'))).toBe(false);
  });

  it('surfaces the server refusal when the target is no longer available', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/backup/restore') && init?.method === 'POST') {
        return jsonResponse(400, { error: 'Restore target is not an available disposable target' });
      }
      if (String(url).endsWith('/api/backup/restore')) return jsonResponse(200, { restoreTargets: ['drill_1'] });
      return jsonResponse(200, { backups: [BACKUP] });
    });
    render(<BackupSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /restore/i }));

    expect(await screen.findByText(/not an available disposable target/i)).toBeInTheDocument();
  });
});
