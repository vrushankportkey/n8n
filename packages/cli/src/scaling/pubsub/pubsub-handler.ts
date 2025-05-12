import { PubSubMetadata } from '@n8n/decorators';
import { Container, Service } from '@n8n/di';
import { InstanceSettings } from 'n8n-core';

import { EventService } from '@/events/event.service';
import type { PubSubEventMap } from '@/events/maps/pub-sub.event-map';
import { Push } from '@/push';
import { assertNever } from '@/utils';

/**
 * Responsible for handling events emitted from messages received via a pubsub channel.
 */
@Service()
export class PubSubHandler {
	constructor(
		private readonly pubSubMetadata: PubSubMetadata,
		private readonly eventService: EventService,
		private readonly instanceSettings: InstanceSettings,
		private readonly push: Push,
	) {}

	init() {
		switch (this.instanceSettings.instanceType) {
			case 'webhook':
			case 'worker':
				this.setupHandlers();
				this.setupHandlers();
				break;
			case 'main':
				// TODO: move these to decorated methods
				this.setupHandlers({
					'display-workflow-activation': async ({ workflowId }) =>
						this.push.broadcast({ type: 'workflowActivated', data: { workflowId } }),
					'display-workflow-deactivation': async ({ workflowId }) =>
						this.push.broadcast({ type: 'workflowDeactivated', data: { workflowId } }),
					'display-workflow-activation-error': async ({ workflowId, errorMessage }) =>
						this.push.broadcast({
							type: 'workflowFailedToActivate',
							data: { workflowId, errorMessage },
						}),
					'relay-execution-lifecycle-event': async ({ pushRef, ...pushMsg }) => {
						if (!this.push.hasPushRef(pushRef)) return;

						this.push.send(pushMsg, pushRef);
					},
				});
				break;
			default:
				assertNever(this.instanceSettings.instanceType);
		}
	}

	private setupHandlers<EventNames extends keyof PubSubEventMap>(
		map: {
			[EventName in EventNames]?: (event: PubSubEventMap[EventName]) => void | Promise<void>;
		} = {},
	) {
		// TODO: delete this block
		for (const [eventName, handlerFn] of Object.entries(map) as Array<
			[EventNames, (event: PubSubEventMap[EventNames]) => void | Promise<void>]
		>) {
			this.eventService.on(eventName, async (event) => {
				await handlerFn(event);
			});
		}

		// TODO: update all pubsub-code to use the new decorators
		const handlers = this.pubSubMetadata.getHandlers();
		for (const { eventHandlerClass, methodName, eventName } of handlers) {
			const instance = Container.get(eventHandlerClass);
			// TODO: setup a separate event-bus for pub-sub
			this.eventService.on(eventName, async () => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return instance[methodName].call(instance);
			});
		}
	}
}
