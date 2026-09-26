export interface TemplateScope {
  trigger?: unknown;
  nodes?: Record<string, unknown>;
  vars?: Record<string, unknown>;
}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

export function resolveTemplates<T>(value: T, scope: TemplateScope): T {
  return resolveValue(value, scope) as T;
}

function resolveValue(value: unknown, scope: TemplateScope): unknown {
  if (typeof value === 'string') return resolveString(value, scope);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = resolveValue(child, scope);
    }
    return out;
  }
  return value;
}

function resolveString(value: string, scope: TemplateScope): unknown {
  const whole = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (whole?.[1]) return readPath(scope, whole[1].trim());
  return value.replace(TOKEN, (_match, path: string) => {
    const resolved = readPath(scope, path.trim());
    if (resolved == null) return '';
    return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
  });
}

export function readPath(scope: TemplateScope, path: string): unknown {
  if (path.startsWith('nodes.')) {
    const rest = path.slice('nodes.'.length);
    const ids = Object.keys(scope.nodes ?? {}).sort((a, b) => b.length - a.length);
    for (const id of ids) {
      if (rest === id) return scope.nodes?.[id];
      if (rest.startsWith(`${id}.`) || rest.startsWith(`${id}[`)) {
        return dig(scope.nodes?.[id], rest.slice(id.length).replace(/^\./, ''));
      }
    }
  }
  return dig(scope, path);
}

function dig(root: unknown, path: string): unknown {
  const parts = path.match(/[^.[\]]+|\[(?:(\d+)|"([^"]+)"|'([^']+)')\]/g);
  if (!parts) return undefined;
  let current: unknown = root;
  for (const part of parts) {
    if (current == null) return undefined;
    const indexed = part.match(/^\[(\d+)\]$/);
    if (indexed?.[1]) {
      current = Array.isArray(current) ? current[Number(indexed[1])] : undefined;
      continue;
    }
    const quoted = part.match(/^\["([^"]+)"\]$/) ?? part.match(/^\['([^']+)'\]$/);
    const key = quoted?.[1] ?? part;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
