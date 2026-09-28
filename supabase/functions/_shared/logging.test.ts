import { logError, redactLogValue, safeStringify } from './logging.ts';

const secrets = [
  'patient@example.test',
  'MRN-7F3A9C',
  '1987-04-12',
  'Jane',
  'Jane Patient',
  'Bearer edge-secret',
  'session=edge-cookie',
];

Deno.test('redactLogValue removes nested PHI and provider responses', () => {
  const result = redactLogValue({
    providerResponse: {
      id: 'response-1',
      model: 'safe-model',
      message: 'Jane',
      choices: [{ message: { content: 'Jane Patient patient@example.test MRN-7F3A9C' } }],
      metadata: { email: 'patient@example.test', patient_dob: '1987-04-12' },
      usage: { total_tokens: 12 },
    },
    request: {
      url: 'https://api.example.test?mrn=MRN-7F3A9C&token=edge-secret',
      headers: { authorization: 'Bearer edge-secret', cookie: 'session=edge-cookie' },
      body: { email: 'patient@example.test' },
    },
  });
  const serialized = safeStringify(result);
  for (const secret of secrets) {
    if (serialized.includes(secret)) throw new Error(`secret leaked: ${secret}`);
  }
  if ((result as { providerResponse: { id: string } }).providerResponse.id !== 'response-1') throw new Error('safe provider id was removed');
  if ((result as { providerResponse: { usage: { total_tokens: number } } }).providerResponse.usage.total_tokens !== 12) throw new Error('safe usage was removed');
});

Deno.test('logError emits a bounded event with stable ID and no raw error', () => {
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => lines.push(String(args[0]));
  try {
    logError('ai.provider_error', new Error('failed for patient@example.test'), {
      provider: 'openai',
      status: 502,
      response: { body: 'Jane Patient' },
    });
  } finally {
    console.error = originalError;
  }
  if (lines.length !== 1) throw new Error('expected one log line');
  const entry = JSON.parse(lines[0]) as Record<string, unknown>;
  const serialized = JSON.stringify(entry);
  for (const secret of secrets) {
    if (serialized.includes(secret)) throw new Error(`secret leaked: ${secret}`);
  }
  if (!/^evt_/.test(String(entry.eventId))) throw new Error('event ID is missing');
  if (entry.event !== 'ai.provider_error') throw new Error('event name is missing');
  if ((entry.context as Record<string, unknown>).provider !== 'openai') throw new Error('safe provider context is missing');
});
