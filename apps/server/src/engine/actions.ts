import type { NodeDefinition, ProviderId } from '@agents/shared';
import type { ConnectionRef, ExecutionServices, RunContext } from './types.js';

type Config = Record<string, unknown>;

export async function performAction(
  type: string,
  config: Config,
  ctx: RunContext,
  services: ExecutionServices,
): Promise<unknown> {
  switch (type) {
    case 'trigger.manual':
    case 'trigger.schedule':
    case 'trigger.webhook':
    case 'trigger.gmail_new_email':
    case 'trigger.slack_message':
    case 'trigger.notion_item_added':
      return isObject(ctx.trigger) ? ctx.trigger : { value: ctx.trigger ?? null };
    case 'logic.set_variable': {
      const name = String(config.name ?? '');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error('Variable names start with a letter and use letters, numbers, or underscores.');
      }
      ctx.vars[name] = config.value ?? '';
      return { name, value: ctx.vars[name] };
    }
    case 'logic.if':
      return { result: compare(config.left, String(config.operator ?? 'eq'), config.right) };
    case 'logic.switch':
      return { value: config.value ?? '' };
    case 'logic.delay':
      return { seconds: Number(config.seconds ?? 0) };
    case 'logic.approval':
      return { summary: String(config.summary ?? '') };
    case 'ai.prompt':
      return promptNode(config, ctx, services);
    case 'ai.classify':
      return classifyNode(config, ctx, services);
    case 'gmail.send':
      return gmailSend(config, services, false);
    case 'gmail.reply':
      return gmailSend(config, services, true);
    case 'gmail.search':
      return gmailSearch(config, services);
    case 'gcal.create_event':
      return gcalCreate(config, services);
    case 'gcal.list_events':
      return gcalList(config, services);
    case 'slack.post_message':
      return slackPost(config, services);
    case 'notion.create_page':
      return notionCreate(config, services);
    case 'notion.update_page':
      return notionUpdate(config, services);
    case 'notion.query_database':
      return notionQuery(config, services);
    case 'excel.append_row':
      return excelAppend(config, services);
    case 'excel.read_range':
      return excelRead(config, services);
    case 'http.request':
      return httpRequest(config, services);
    default:
      throw new Error(`No executor for ${type}.`);
  }
}

export function branchHandle(type: string, config: Config, data: unknown): string {
  if (type === 'logic.if') {
    return isObject(data) && data.result === true ? 'true' : 'false';
  }
  if (type === 'logic.switch') {
    const value = String(config.value ?? '');
    if (config.case1 != null && value === String(config.case1)) return 'case1';
    if (config.case2 != null && config.case2 !== '' && value === String(config.case2)) return 'case2';
    if (config.case3 != null && config.case3 !== '' && value === String(config.case3)) return 'case3';
    return 'default';
  }
  if (type === 'logic.loop') return 'done';
  if (type === 'logic.approval') return 'approved';
  return 'out';
}

export function actionSummary(def: NodeDefinition, config: Config): string {
  if (def.type === 'gmail.send') return `Send email to ${text(config.to)}: ${text(config.subject)}`;
  if (def.type === 'gmail.reply') return `Reply to ${text(config.to)}: ${text(config.subject)}`;
  if (def.type === 'gcal.create_event') return `Create event “${text(config.summary)}”`;
  if (def.type === 'slack.post_message') return `Post to Slack: ${text(config.text).slice(0, 180)}`;
  if (def.type === 'notion.create_page') return `Create Notion page “${text(config.title)}”`;
  if (def.type === 'notion.update_page') return `Update Notion page ${text(config.pageId)}`;
  if (def.type === 'excel.append_row') return `Append a row to ${text(config.workbookPath)}`;
  if (def.type === 'http.request') return `${text(config.method)} ${text(config.url)}`;
  return `Run ${def.label}`;
}

async function promptNode(config: Config, ctx: RunContext, services: ExecutionServices): Promise<unknown> {
  const response = await services.llm({
    provider: config.provider === 'openai' ? 'openai' : 'anthropic',
    model: text(config.model),
    messages: [
      { role: 'system', content: text(config.system) || 'You are a careful assistant.' },
      {
        role: 'user',
        content:
          config.outputMode === 'json' ? `${text(config.prompt)}\nRespond with JSON only.` : text(config.prompt),
      },
    ],
  });
  addTokenUsage(ctx, response.usage);
  if (config.outputMode === 'json') {
    return { text: response.content, json: parseJson(response.content) };
  }
  return { text: response.content };
}

async function classifyNode(config: Config, ctx: RunContext, services: ExecutionServices): Promise<unknown> {
  const categories = text(config.categories)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const response = await services.llm({
    provider: config.provider === 'openai' ? 'openai' : 'anthropic',
    model: text(config.model),
    messages: [
      {
        role: 'system',
        content: `Classify the input into exactly one of: ${categories.join(', ')}. Respond with JSON {"category":"..."} and nothing else.`,
      },
      { role: 'user', content: text(config.input) },
    ],
  });
  addTokenUsage(ctx, response.usage);
  const parsed = parseJson(response.content);
  const category = isObject(parsed) ? String(parsed.category ?? categories[0] ?? '') : categories[0] ?? '';
  return { category, raw: response.content };
}

async function gmailSend(config: Config, services: ExecutionServices, reply: boolean): Promise<unknown> {
  const connection = await requireConnection('gmail', config, services, true);
  const raw = encodeMime({
    to: text(config.to),
    subject: text(config.subject),
    body: text(config.body),
  });
  const payload: Record<string, unknown> = { raw };
  if (reply && text(config.threadId)) payload.threadId = text(config.threadId);
  const data = await services.nangoProxy(connection, '/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: payload,
  });
  return { id: isObject(data) ? data.id : null, threadId: isObject(data) ? data.threadId : null };
}

async function gmailSearch(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('gmail', config, services, false);
  const max = clamp(Number(config.maxResults ?? 5), 1, 20);
  const listed = await services.nangoProxy(
    connection,
    `/gmail/v1/users/me/messages?q=${encodeURIComponent(text(config.query))}&maxResults=${max}`,
    { method: 'GET' },
  );
  const ids = isObject(listed) && Array.isArray(listed.messages) ? listed.messages : [];
  const messages = [];
  for (const item of ids.slice(0, max)) {
    if (!isObject(item) || typeof item.id !== 'string') continue;
    const full = await services.nangoProxy(connection, `/gmail/v1/users/me/messages/${item.id}?format=full`, {
      method: 'GET',
    });
    messages.push(normalizeGmail(full));
  }
  return { messages };
}

export function normalizeGmail(message: unknown): Record<string, unknown> {
  const payload = isObject(message) && isObject(message.payload) ? message.payload : {};
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  return {
    id: isObject(message) ? message.id : null,
    threadId: isObject(message) ? message.threadId : null,
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    subject: headerValue(headers, 'Subject'),
    snippet: isObject(message) ? message.snippet ?? '' : '',
    body: extractBody(payload).slice(0, 8000),
  };
}

async function gcalCreate(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('gcal', config, services, true);
  const data = await services.nangoProxy(connection, '/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: {
      summary: text(config.summary),
      description: text(config.description),
      start: { dateTime: text(config.start) },
      end: { dateTime: text(config.end) },
    },
  });
  return { id: isObject(data) ? data.id : null, htmlLink: isObject(data) ? data.htmlLink : null };
}

async function gcalList(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('gcal', config, services, false);
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(clamp(Number(config.maxResults ?? 10), 1, 25)),
    timeMin: text(config.timeMin) || services.now().toISOString(),
  });
  if (text(config.timeMax)) params.set('timeMax', text(config.timeMax));
  const data = await services.nangoProxy(connection, `/calendar/v3/calendars/primary/events?${params}`, {
    method: 'GET',
  });
  const events = isObject(data) && Array.isArray(data.items) ? data.items : [];
  return {
    events: events.map((event) => {
      if (!isObject(event)) return event;
      return {
        id: event.id,
        summary: event.summary ?? '',
        start: isObject(event.start) ? (event.start.dateTime ?? event.start.date) : null,
        end: isObject(event.end) ? (event.end.dateTime ?? event.end.date) : null,
        htmlLink: event.htmlLink ?? null,
      };
    }),
  };
}

async function slackPost(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('slack', config, services, true);
  const data = await services.nangoProxy(connection, '/chat.postMessage', {
    method: 'POST',
    body: { channel: text(config.channel), text: text(config.text) },
  });
  if (isObject(data) && data.ok === false) throw new Error(String(data.error ?? 'Slack rejected the message.'));
  return { ts: isObject(data) ? data.ts : null, channel: isObject(data) ? data.channel : text(config.channel) };
}

async function notionCreate(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('notion', config, services, true);
  const title = text(config.title);
  const titleProperty = text(config.titleProperty) || 'Name';
  const parent = text(config.databaseId)
    ? { database_id: text(config.databaseId) }
    : { page_id: text(config.parentPageId) };
  if (!text(config.databaseId) && !text(config.parentPageId)) {
    throw new Error('Add a Notion database ID or parent page ID.');
  }
  const properties = text(config.databaseId)
    ? { [titleProperty]: { title: [{ text: { content: title } }] } }
    : { title: { title: [{ text: { content: title } }] } };
  const data = await services.nangoProxy(connection, '/v1/pages', {
    method: 'POST',
    headers: { 'Notion-Version': '2022-06-28' },
    body: {
      parent,
      properties,
      children: text(config.content)
        ? [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: text(config.content).slice(0, 2000) } }] },
            },
          ]
        : [],
    },
  });
  return { id: isObject(data) ? data.id : null, url: isObject(data) ? data.url : null };
}

async function notionUpdate(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('notion', config, services, true);
  const data = await services.nangoProxy(connection, `/v1/blocks/${text(config.pageId)}/children`, {
    method: 'PATCH',
    headers: { 'Notion-Version': '2022-06-28' },
    body: {
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: text(config.content).slice(0, 2000) } }] },
        },
      ],
    },
  });
  return { id: text(config.pageId), result: data };
}

async function notionQuery(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('notion', config, services, false);
  const filter = parseMaybeJson(config.filter);
  const data = await services.nangoProxy(connection, `/v1/databases/${text(config.databaseId)}/query`, {
    method: 'POST',
    headers: { 'Notion-Version': '2022-06-28' },
    body: {
      page_size: clamp(Number(config.pageSize ?? 10), 1, 20),
      ...(filter ? { filter } : {}),
    },
  });
  const results = isObject(data) && Array.isArray(data.results) ? data.results : [];
  return {
    pages: results.map((page) => ({
      id: isObject(page) ? page.id : null,
      url: isObject(page) ? page.url : null,
      title: notionTitle(page),
    })),
  };
}

async function excelAppend(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('excel', config, services, true);
  const base = workbookBase(text(config.workbookPath));
  const sheet = encodeURIComponent(text(config.worksheet));
  const used = await services.nangoProxy(connection, `${base}/workbook/worksheets/${sheet}/usedRange`, {
    method: 'GET',
  });
  const rowCount = isObject(used) ? Number(used.rowCount ?? 0) : 0;
  const next = (Number.isFinite(rowCount) ? rowCount : 0) + 1;
  const values = parseRow(config.values);
  const end = columnName(values.length);
  await services.nangoProxy(
    connection,
    `${base}/workbook/worksheets/${sheet}/range(address='${encodeURIComponent(`A${next}:${end}${next}`)}')`,
    { method: 'PATCH', body: { values: [values] } },
  );
  return { row: next, values };
}

async function excelRead(config: Config, services: ExecutionServices): Promise<unknown> {
  const connection = await requireConnection('excel', config, services, false);
  const base = workbookBase(text(config.workbookPath));
  const sheet = encodeURIComponent(text(config.worksheet));
  const range = encodeURIComponent(text(config.range));
  const data = await services.nangoProxy(
    connection,
    `${base}/workbook/worksheets/${sheet}/range(address='${range}')`,
    { method: 'GET' },
  );
  return { address: isObject(data) ? data.address : text(config.range), values: isObject(data) ? data.values ?? [] : [] };
}

async function httpRequest(config: Config, services: ExecutionServices): Promise<unknown> {
  const method = text(config.method || 'GET').toUpperCase();
  const url = text(config.url);
  const blocked = blockedUrl(url);
  if (blocked) throw new Error(blocked);
  const headers = parseHeaders(config.headers);
  const response = await services.fetchImpl(url, {
    method,
    headers,
    body: method === 'GET' || method === 'DELETE' ? undefined : text(config.body) || undefined,
  });
  const body = (await response.text()).slice(0, 20000);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  return { status: response.status, body: parseMaybeJson(body) ?? body };
}

async function requireConnection(
  provider: ProviderId,
  config: Config,
  services: ExecutionServices,
  write: boolean,
): Promise<ConnectionRef> {
  const connection = await services.resolveConnection(
    provider,
    typeof config.connectionId === 'string' ? config.connectionId : undefined,
  );
  if (!connection) throw new Error(`Connect ${provider} in the Connections tab first.`);
  if (write && connection.accessMode !== 'read_write') {
    throw new Error(`The ${provider} connection is read-only. Allow writes in Connections.`);
  }
  return connection;
}

export function addTokenUsage(ctx: RunContext, usage?: { input: number; output: number }): void {
  if (!usage) return;
  ctx.tokenUsage.input += usage.input;
  ctx.tokenUsage.output += usage.output;
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  if (operator === 'exists') return left != null && left !== '';
  if (operator === 'not_exists') return left == null || left === '';
  if (operator === 'contains') return String(left ?? '').includes(String(right ?? ''));
  if (operator === 'gt' || operator === 'lt') {
    const a = Number(left);
    const b = Number(right);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return operator === 'gt' ? a > b : a < b;
  }
  if (operator === 'neq') return String(left ?? '') !== String(right ?? '');
  return String(left ?? '') === String(right ?? '');
}

function encodeMime(message: { to: string; subject: string; body: string }): string {
  const lines = [
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

function extractBody(payload: Record<string, unknown>): string {
  if (isObject(payload.body) && typeof payload.body.data === 'string') return decodeBase64Url(payload.body.data);
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    if (!isObject(part)) continue;
    if (part.mimeType === 'text/plain' && isObject(part.body) && typeof part.body.data === 'string') {
      return decodeBase64Url(part.body.data);
    }
  }
  for (const part of parts) {
    if (!isObject(part)) continue;
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return '';
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function headerValue(headers: unknown[], name: string): string {
  const match = headers.find((header) => isObject(header) && String(header.name).toLowerCase() === name.toLowerCase());
  return isObject(match) ? String(match.value ?? '') : '';
}

function notionTitle(page: unknown): string {
  if (!isObject(page) || !isObject(page.properties)) return '';
  for (const property of Object.values(page.properties)) {
    if (isObject(property) && property.type === 'title' && Array.isArray(property.title)) {
      return property.title.map((part) => (isObject(part) ? text(part.plain_text) : '')).join('');
    }
  }
  return '';
}

export function blockedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full http or https URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https URLs are allowed.';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1') {
    return 'That host is blocked.';
  }
  if (host === 'metadata.google.internal') return 'That host is blocked.';
  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const privateRange =
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
  return privateRange ? 'That host is blocked.' : null;
}

function parseHeaders(value: unknown): Record<string, string> {
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
  }
  const headers: Record<string, string> = {};
  for (const line of text(value).split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return headers;
}

function parseRow(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  const raw = text(value);
  if (raw.startsWith('[')) {
    const parsed = parseMaybeJson(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  }
  return raw.split(',').map((item) => item.trim());
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJson(textValue: string): unknown {
  const start = textValue.indexOf('{');
  const end = textValue.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  return parseMaybeJson(textValue.slice(start, end + 1));
}

function workbookBase(workbookPath: string): string {
  const encoded = workbookPath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `/v1.0/me/drive/root:/${encoded}:`;
}

function columnName(count: number): string {
  let n = Math.max(count, 1);
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
