import type { ChannelAdapterFactory, ChannelDescriptor } from './types.ts';

export class ChannelRegistry {
  private readonly factories = new Map<string, ChannelAdapterFactory>();
  register(factory: ChannelAdapterFactory): void {
    const id = factory.descriptor.id;
    if (!id.trim()) throw new Error('Channel id is required');
    if (this.factories.has(id)) throw new Error(`Channel already registered: ${id}`);
    this.factories.set(id, factory);
  }
  get(channelId: string): ChannelAdapterFactory {
    const factory = this.factories.get(channelId);
    if (!factory) throw new Error(`Unknown channel: ${channelId}`);
    return factory;
  }
  list(): readonly ChannelDescriptor[] {
    return [...this.factories.values()].map(factory => factory.descriptor);
  }
}
