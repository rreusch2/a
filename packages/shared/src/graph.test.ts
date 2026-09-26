import { describe, expect, it } from 'vitest';
import { starterGraph, validateGraph } from './graph.js';
import { agentTemplates } from './templates.js';

describe('validateGraph', () => {
  it('accepts the starter graph as a draft and asks for nothing else', () => {
    expect(validateGraph(starterGraph(), 'draft')).toEqual([]);
  });

  it('requires a trigger and required fields before publish', () => {
    const issues = validateGraph(
      {
        nodes: [
          {
            id: 'send',
            type: 'gmail.send',
            position: { x: 0, y: 0 },
            config: { to: 'a@b.co' },
          },
        ],
        edges: [],
      },
      'publish',
    );
    expect(issues.some((issue) => issue.message.includes('trigger'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('Subject'))).toBe(true);
  });

  it('rejects an edge into a trigger', () => {
    const issues = validateGraph(
      {
        nodes: [
          { id: 'a', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'b', type: 'logic.set_variable', position: { x: 0, y: 0 }, config: { name: 'x', value: '1' } },
        ],
        edges: [{ id: 'e', source: 'b', sourceHandle: 'out', target: 'a', targetHandle: 'in' }],
      },
      'draft',
    );
    expect(issues.some((issue) => issue.message.includes('Triggers'))).toBe(true);
  });

  it('publishes every seeded template once required blanks are ignored in draft mode', () => {
    for (const template of agentTemplates) {
      const issues = validateGraph(template.graph, 'draft');
      expect(issues, template.name).toEqual([]);
    }
  });
});
