import { z, type ZodTypeAny } from 'zod';
import type { FieldDef, NodeDefinition } from './types.js';

export function defineNode(
  def: Omit<NodeDefinition, 'configSchema'> & { configSchema?: ZodTypeAny },
): NodeDefinition {
  return {
    ...def,
    configSchema: def.configSchema ?? schemaFromFields(def.fields),
  };
}

function schemaFromFields(fields: FieldDef[]): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of fields) {
    let schema: ZodTypeAny;
    switch (field.kind) {
      case 'number':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'json':
        schema = z.union([z.string(), z.record(z.unknown()), z.array(z.unknown()), z.null()]);
        break;
      default:
        schema = z.string();
    }
    shape[field.key] = schema.optional();
  }
  shape.confirm = z.boolean().optional();
  return z.object(shape).passthrough();
}

export function coerceConfig(
  fields: FieldDef[],
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(config ?? {}) };
  for (const field of fields) {
    const value = next[field.key];
    if (field.kind === 'number' && typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) next[field.key] = parsed;
    }
    if (field.kind === 'boolean' && typeof value === 'string') {
      next[field.key] = value === 'true';
    }
  }
  return next;
}
