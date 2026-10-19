import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewedExemptions, scanText } from '../../scripts/verify-agent-boundaries.mjs';

describe('agent boundary gate', () => {
  it('flags direct shell, SQL, HTTP, and tool permissions', () => {
    const source = `
      import { exec } from 'node:child_process';
      exec('rm -rf /');
      await fetch('https://example.com');
      await supabase.rpc('run_sql', { sql: 'select 1' });
      const result = await tools.execute({ name: 'shell' });
    `;
    const findings = scanText('agent/worker.ts', source);
    const rules = new Set(findings.map((finding) => finding.rule));
    assert.equal(rules.has('shell'), true);
    assert.equal(rules.has('sql'), true);
    assert.equal(rules.has('http'), true);
    assert.equal(rules.has('tool'), true);
  });

  it('flags an unapproved MCP configuration', () => {
    const findings = scanText('config/unapproved-mcp.json', '{"mcpServers":{"exa":{"baseUrl":"https://mcp.exa.ai/mcp"}}}');
    assert.equal(findings.some((finding) => finding.rule === 'tool'), true);
  });

  it('records the existing local MCP config as an explicit reviewed exemption', () => {
    const findings = scanText('config/mcporter.json', '{"mcpServers":{"exa":{"baseUrl":"https://mcp.exa.ai/mcp"}}}');
    assert.equal(findings.length, 0);
    assert.equal(reviewedExemptions.has('config/mcporter.json'), true);
  });

  it('allows only explicitly reviewed exemptions', () => {
    const source = 'await fetch("https://api.openai.com/v1/chat/completions");';
    const findings = scanText('supabase/functions/ai-insights/index.ts', source);
    assert.equal(findings.length, 0);
    assert.equal(reviewedExemptions.has('supabase/functions/ai-insights/index.ts'), true);
  });

  it('releases AI quota through the service-role client', () => {
    const source = readFileSync(
      new URL('../../supabase/functions/ai-insights/index.ts', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(source, /releaseAiQuota\(supabase,/);
    assert.match(source, /releaseAiQuota\(serviceSupabase, reservationId\)/);
  });
});
