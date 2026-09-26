import { describe, expect, it } from 'vitest';
import { resolveTemplates } from './expressions.js';

const scope = {
  trigger: { subject: 'Hello' },
  nodes: {
    inbox: { from: 'a@b.co', messages: [{ id: 'm1' }] },
    'draft-reply': { text: 'Sure' },
  },
  vars: { item: { name: 'Ada' }, index: 1 },
};

describe('resolveTemplates', () => {
  it('returns the raw value when the whole string is one template', () => {
    expect(resolveTemplates('{{nodes.inbox.messages}}', scope)).toEqual([{ id: 'm1' }]);
  });

  it('interpolates inside longer text and preserves missing paths as empty', () => {
    expect(resolveTemplates('Hi {{nodes.inbox.from}} — {{nodes.missing.name}}', scope)).toBe('Hi a@b.co — ');
  });

  it('matches node ids that contain hyphens', () => {
    expect(resolveTemplates('{{nodes.draft-reply.text}}', scope)).toBe('Sure');
  });

  it('reads indexes and vars', () => {
    expect(resolveTemplates('{{nodes.inbox.messages[0].id}}', scope)).toBe('m1');
    expect(resolveTemplates('{{vars.item.name}} #{{vars.index}}', scope)).toBe('Ada #1');
  });

  it('walks objects and arrays', () => {
    expect(resolveTemplates({ to: '{{nodes.inbox.from}}', n: 2 }, scope)).toEqual({ to: 'a@b.co', n: 2 });
  });
});
