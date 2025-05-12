import { Container } from '@n8n/di';

import { type PubSubEvent, PubSubMetadata } from './pub-sub-metadata';
import { NonMethodError } from '../errors';
import type { EventHandlerClass } from '../types';

export const OnPubSubEvent =
	(eventName: PubSubEvent): MethodDecorator =>
	(prototype, propertyKey, descriptor) => {
		const eventHandlerClass = prototype.constructor as EventHandlerClass;
		const methodName = String(propertyKey);

		if (typeof descriptor?.value !== 'function') {
			throw new NonMethodError(`${eventHandlerClass.name}.${methodName}()`);
		}

		Container.get(PubSubMetadata).register({
			eventHandlerClass,
			methodName,
			eventName,
		});
	};
