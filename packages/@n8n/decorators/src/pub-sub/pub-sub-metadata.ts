import { Service } from '@n8n/di';

import type { EventHandler } from '../types';

// TODO: import this from a shared location
export type PubSubEvent =
	| 'add-webhooks-triggers-and-pollers'
	| 'remove-triggers-and-pollers'
	| 'clear-test-webhooks'
	| 'community-package-install'
	| 'community-package-uninstall'
	| 'community-package-update'
	| 'get-worker-status'
	| 'reload-external-secrets-providers'
	| 'reload-license'
	| 'response-to-get-worker-status'
	| 'restart-event-bus';

type PubSubEventHandler = EventHandler<PubSubEvent>;

@Service()
export class PubSubMetadata {
	private readonly handlers: PubSubEventHandler[] = [];

	register(handler: PubSubEventHandler) {
		this.handlers.push(handler);
	}

	getHandlers(): PubSubEventHandler[] {
		return this.handlers;
	}
}
