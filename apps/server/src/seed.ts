import { agentTemplates } from '@agents/shared';
import { createAdminClient } from './db.js';

export async function seedTemplates(): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('templates').upsert(
    agentTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      graph: template.graph,
      required_providers: template.requiredProviders,
      featured: template.featured,
    })),
    { onConflict: 'id' },
  );
  if (error) console.error('Could not seed templates', error.message);
}
