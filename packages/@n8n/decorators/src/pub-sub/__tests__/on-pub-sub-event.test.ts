import { Container } from '@n8n/di';
import { Service } from '@n8n/di';
import { EventEmitter } from 'node:events';

import { NonMethodError } from '../../errors';
import { OnPubSubEvent } from '../on-pub-sub-event';
import { PubSubMetadata } from '../pub-sub-metadata';

class MockPubSubSetup extends EventEmitter {
	registerEventHandlers() {
		const handlers = Container.get(PubSubMetadata).getHandlers();

		for (const { eventHandlerClass, methodName, eventName } of handlers) {
			const instance = Container.get(eventHandlerClass);
			this.on(eventName, async () => {
				return await instance[methodName].call(instance);
			});
		}
	}
}

let pubSubSetup: MockPubSubSetup;
let metadata: PubSubMetadata;

beforeEach(() => {
	Container.reset();

	metadata = new PubSubMetadata();
	Container.set(PubSubMetadata, metadata);

	pubSubSetup = new MockPubSubSetup();
});

it('should register methods decorated with @OnPubSubEvent', () => {
	jest.spyOn(metadata, 'register');

	@Service()
	class TestService {
		@OnPubSubEvent('reload-external-secrets-providers')
		async reloadProviders() {}
	}

	expect(metadata.register).toHaveBeenCalledWith({
		eventName: 'reload-external-secrets-providers',
		methodName: 'reloadProviders',
		eventHandlerClass: TestService,
	});
});

it('should throw an error if the decorated target is not a method', () => {
	expect(() => {
		@Service()
		class TestService {
			// @ts-expect-error Testing invalid code
			@OnPubSubEvent('reload-external-secrets-providers')
			notAFunction = 'string';
		}

		new TestService();
	}).toThrowError(NonMethodError);
});

it('should call decorated methods when events are emitted', async () => {
	@Service()
	class TestService {
		reloadCalled = false;

		@OnPubSubEvent('reload-external-secrets-providers')
		async reloadProviders() {
			this.reloadCalled = true;
		}
	}

	const testService = Container.get(TestService);
	jest.spyOn(testService, 'reloadProviders');

	pubSubSetup.registerEventHandlers();

	pubSubSetup.emit('reload-external-secrets-providers');

	expect(testService.reloadProviders).toHaveBeenCalledTimes(1);
	expect(testService.reloadCalled).toBe(true);
});
