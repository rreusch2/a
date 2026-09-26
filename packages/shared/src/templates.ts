import type { Graph } from './graph.js';
import type { ProviderId } from './nodes/types.js';

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  graph: Graph;
  requiredProviders: ProviderId[];
  featured: boolean;
}

function node(
  id: string,
  type: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
) {
  return { id, type, position: { x, y }, config };
}

function edge(id: string, source: string, target: string, sourceHandle = 'out', targetHandle = 'in') {
  return { id, source, sourceHandle, target, targetHandle };
}

export const agentTemplates: AgentTemplate[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Email auto-responder',
    description: 'Reads a new email, drafts a reply, and waits for your approval before sending it.',
    category: 'Email',
    featured: true,
    requiredProviders: ['gmail'],
    graph: {
      nodes: [
        node('inbox', 'trigger.gmail_new_email', 24, 180, { query: 'is:inbox is:unread' }),
        node('draft', 'ai.prompt', 280, 160, {
          provider: 'anthropic',
          outputMode: 'text',
          system: 'You draft short, friendly email replies. Do not invent facts. If you cannot answer, say a human will follow up.',
          prompt:
            'Reply to this email.\nFrom: {{nodes.inbox.from}}\nSubject: {{nodes.inbox.subject}}\n\n{{nodes.inbox.body}}',
        }),
        node('check', 'logic.approval', 540, 160, {
          summary: 'Send this reply to {{nodes.inbox.from}}?\n\n{{nodes.draft.text}}',
        }),
        node('send', 'gmail.reply', 800, 120, {
          messageId: '{{nodes.inbox.id}}',
          threadId: '{{nodes.inbox.threadId}}',
          to: '{{nodes.inbox.from}}',
          subject: 'Re: {{nodes.inbox.subject}}',
          body: '{{nodes.draft.text}}',
          confirm: false,
        }),
      ],
      edges: [
        edge('e1', 'inbox', 'draft'),
        edge('e2', 'draft', 'check'),
        edge('e3', 'check', 'send', 'approved'),
      ],
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Morning calendar briefing',
    description: 'Every weekday at 8:00 UTC, summarizes today\'s calendar and posts it to Slack.',
    category: 'Productivity',
    featured: true,
    requiredProviders: ['gcal', 'slack'],
    graph: {
      nodes: [
        node('clock', 'trigger.schedule', 24, 180, { cron: '0 8 * * 1-5' }),
        node('events', 'gcal.list_events', 280, 170, { maxResults: 10 }),
        node('brief', 'ai.prompt', 540, 160, {
          provider: 'anthropic',
          outputMode: 'text',
          system: 'Write a tight morning briefing. Use plain sentences. Mention times and titles only.',
          prompt: 'Turn these calendar events into a morning briefing:\n{{nodes.events.events}}',
        }),
        node('post', 'slack.post_message', 800, 170, {
          channel: 'C0123456789',
          text: '{{nodes.brief.text}}',
          confirm: true,
        }),
      ],
      edges: [
        edge('e1', 'clock', 'events'),
        edge('e2', 'events', 'brief'),
        edge('e3', 'brief', 'post'),
      ],
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Slack note to Notion',
    description: 'Saves a Slack message as a new Notion page.',
    category: 'Notes',
    featured: true,
    requiredProviders: ['slack', 'notion'],
    graph: {
      nodes: [
        node('msg', 'trigger.slack_message', 24, 180, {}),
        node('page', 'notion.create_page', 320, 160, {
          databaseId: '',
          titleProperty: 'Name',
          title: '{{nodes.msg.text}}',
          content: 'From Slack channel {{nodes.msg.channel}} by {{nodes.msg.user}}:\n\n{{nodes.msg.text}}',
          confirm: true,
        }),
      ],
      edges: [edge('e1', 'msg', 'page')],
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Form webhook to Excel',
    description: 'Appends each webhook payload as a row in an Excel workbook.',
    category: 'Data',
    featured: true,
    requiredProviders: ['excel'],
    graph: {
      nodes: [
        node('hook', 'trigger.webhook', 24, 180, { description: 'Form submissions' }),
        node('row', 'excel.append_row', 320, 160, {
          workbookPath: 'Documents/Leads.xlsx',
          worksheet: 'Sheet1',
          values: '{{nodes.hook.name}}, {{nodes.hook.email}}, {{nodes.hook.message}}',
          confirm: false,
        }),
      ],
      edges: [edge('e1', 'hook', 'row')],
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Inbox triage',
    description: 'Classifies a new email and takes the urgent branch only when it matters.',
    category: 'Email',
    featured: false,
    requiredProviders: ['gmail', 'slack'],
    graph: {
      nodes: [
        node('inbox', 'trigger.gmail_new_email', 24, 200, { query: 'is:inbox' }),
        node('label', 'ai.classify', 280, 180, {
          provider: 'anthropic',
          input: 'From: {{nodes.inbox.from}}\nSubject: {{nodes.inbox.subject}}\n\n{{nodes.inbox.snippet}}',
          categories: 'Urgent, Later, FYI',
        }),
        node('gate', 'logic.if', 540, 180, {
          left: '{{nodes.label.category}}',
          operator: 'eq',
          right: 'Urgent',
        }),
        node('ping', 'slack.post_message', 800, 80, {
          channel: 'C0123456789',
          text: 'Urgent email from {{nodes.inbox.from}}: {{nodes.inbox.subject}}',
          confirm: true,
        }),
      ],
      edges: [
        edge('e1', 'inbox', 'label'),
        edge('e2', 'label', 'gate'),
        edge('e3', 'gate', 'ping', 'true'),
      ],
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    name: 'Page summarizer',
    description: 'A button-run agent that fetches a URL and summarizes it.',
    category: 'AI',
    featured: false,
    requiredProviders: [],
    graph: {
      nodes: [
        node('start', 'trigger.manual', 24, 180, {
          sampleInput: { url: 'https://example.com' },
        }),
        node('fetch', 'http.request', 280, 170, {
          method: 'GET',
          url: '{{nodes.start.url}}',
        }),
        node('summary', 'ai.prompt', 540, 160, {
          provider: 'anthropic',
          outputMode: 'text',
          system: 'Summarize the page in five bullets.',
          prompt: 'Summarize this response:\n{{nodes.fetch.body}}',
        }),
      ],
      edges: [
        edge('e1', 'start', 'fetch'),
        edge('e2', 'fetch', 'summary'),
      ],
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000007',
    name: 'Search inbox digest',
    description: 'On demand, searches Gmail and writes a short digest.',
    category: 'Email',
    featured: false,
    requiredProviders: ['gmail'],
    graph: {
      nodes: [
        node('start', 'trigger.manual', 24, 180, {}),
        node('found', 'gmail.search', 280, 170, { query: 'newer_than:1d', maxResults: 5 }),
        node('digest', 'ai.prompt', 540, 160, {
          provider: 'anthropic',
          outputMode: 'text',
          system: 'Write a short digest of these emails.',
          prompt: '{{nodes.found.messages}}',
        }),
      ],
      edges: [
        edge('e1', 'start', 'found'),
        edge('e2', 'found', 'digest'),
      ],
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000008',
    name: 'Notion update to Slack',
    description: 'When a Notion database changes, posts the page title to Slack.',
    category: 'Notes',
    featured: false,
    requiredProviders: ['notion', 'slack'],
    graph: {
      nodes: [
        node('item', 'trigger.notion_item_added', 24, 180, { databaseId: '' }),
        node('post', 'slack.post_message', 340, 170, {
          channel: 'C0123456789',
          text: 'Notion updated: {{nodes.item.title}}',
          confirm: true,
        }),
      ],
      edges: [edge('e1', 'item', 'post')],
    },
  },
];
