import type { ZodTypeAny } from 'zod';

export type ProviderId = 'gmail' | 'gcal' | 'slack' | 'notion' | 'excel';

export type NodeCategory = 'trigger' | 'action' | 'logic' | 'ai';

export interface PortDef {
  id: string;
  label: string;
}

export type FieldDef =
  | {
      kind: 'text' | 'textarea' | 'cron';
      key: string;
      label: string;
      placeholder?: string;
      required?: boolean;
      help?: string;
    }
  | {
      kind: 'number';
      key: string;
      label: string;
      min?: number;
      max?: number;
      required?: boolean;
      help?: string;
    }
  | {
      kind: 'boolean';
      key: string;
      label: string;
      help?: string;
      required?: boolean;
    }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: { label: string; value: string }[];
      required?: boolean;
      help?: string;
    }
  | {
      kind: 'json';
      key: string;
      label: string;
      required?: boolean;
      help?: string;
      placeholder?: string;
    };

export interface NodeDefinition {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  icon: string;
  color: string;
  provider?: ProviderId;
  fields: FieldDef[];
  configSchema: ZodTypeAny;
  inputs: PortDef[];
  outputs: PortDef[];
  sideEffect?: boolean;
  asTool?: { description: string };
  defaults?: Record<string, unknown>;
}

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  trigger: 'Triggers',
  ai: 'AI',
  action: 'Actions',
  logic: 'Logic',
};

export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  trigger: '#5B8DEF',
  ai: '#C084FC',
  action: '#3DDC97',
  logic: '#E08A4F',
};

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  gmail: 'Gmail',
  gcal: 'Google Calendar',
  slack: 'Slack',
  notion: 'Notion',
  excel: 'Excel',
};
