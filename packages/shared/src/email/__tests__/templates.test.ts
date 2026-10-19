// packages/shared/src/email/__tests__/templates.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '../templates';

describe('render', () => {
  it('interpolates and escapes html', () => {
    const out = render({ subject: 'Hi {{to_name}}', html: '<p>{{to_name}}</p>', text: null }, { to_name: '<b>Ada</b>' });
    expect(out.subject).toBe('Hi <b>Ada</b>');
    expect(out.html).toBe('<p>&lt;b&gt;Ada&lt;/b&gt;</p>');
  });
  it('throws on missing variable', () => {
    expect(() => render({ subject: '{{x}}', html: 'a', text: null }, {})).toThrow(/x/);
  });
});
