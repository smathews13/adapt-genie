import { Plugin, toPlugin, type PluginManifest } from '@databricks/appkit';
import type { SlackAdapterBootstrap } from './bootstrap';

class SlackRuntimeLifecyclePlugin extends Plugin {
  static manifest = {
    name: 'slackRuntimeLifecycle',
    displayName: 'Slack runtime lifecycle',
    description: 'Stops the optional Slack Socket Mode adapter during application shutdown.',
    resources: { required: [], optional: [] },
  } satisfies PluginManifest<'slackRuntimeLifecycle'>;

  private adapter: Pick<SlackAdapterBootstrap, 'stop'> | null = null;

  bind(adapter: Pick<SlackAdapterBootstrap, 'stop'>): void {
    this.adapter = adapter;
  }

  async shutdown(): Promise<void> {
    await this.adapter?.stop();
  }

  exports() {
    return { setAdapter: this.bind.bind(this) };
  }
}

export const slackRuntimeLifecycle = toPlugin(SlackRuntimeLifecyclePlugin);
