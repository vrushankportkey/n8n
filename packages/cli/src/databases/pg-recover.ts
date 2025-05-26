import { Service } from '@n8n/di';
import { DataSource } from '@n8n/typeorm';
import { PostgresDriver } from '@n8n/typeorm/driver/postgres/PostgresDriver';
import { ErrorReporter, Logger } from 'n8n-core';
import { ensureError } from 'n8n-workflow';
import type { Pool, PoolClient } from 'pg';

// Internal structure of pg Pool and Client for connection recovery
// These are not part of the public API but are needed for advanced recovery
export interface InternalPoolClient extends PoolClient {
	_ended?: boolean;
	_ending?: boolean;
}

export interface InternalPool extends Pool {
	_clients?: Array<InternalPoolClient | null>;
}

@Service()
export class PgRecover {
	constructor(
		private readonly dataSource: DataSource,
		private readonly errorReporter: ErrorReporter,
		private readonly logger: Logger,
	) {}

	/**
	 * Test method to simulate different types of network issues
	 * This is useful for testing the connection pool recovery mechanism
	 * @param issueType Type of issue to simulate ('network-drop', 'stalled-connections')
	 * @param count Number of connections to affect
	 * @returns Information about the simulated issue
	 */
	async simulateNetworkIssue(
		issueType: 'network-drop' | 'stalled-connections',
		count = 1,
	): Promise<{ success: boolean; message: string }> {
		if (!this.dataSource.isInitialized) {
			return { success: false, message: 'Database not initialized or not PostgreSQL' };
		}

		try {
			const pgDriver = this.dataSource.driver as PostgresDriver;
			const pgPool = pgDriver.master as Pool;

			switch (issueType) {
				case 'network-drop':
					// Simulate network drops by forcing pg driver to emit error events
					this.errorReporter.info(`Simulating ${count} network drops`);
					// Use EventEmitter's emit method to simulate network errors
					for (let i = 0; i < count; i++) {
						(pgPool as unknown as { emit(event: string, e: Error): boolean }).emit(
							'error',
							new Error(`Simulated network drop #${i + 1}`),
						);
					}
					return { success: true, message: `Simulated ${count} network drops` };

				case 'stalled-connections':
					// Simulate stalled connections by marking some connections as ended
					this.errorReporter.info(`Simulating ${count} stalled connections`);
					const internalPool = pgPool as unknown as InternalPool;
					if (internalPool._clients && Array.isArray(internalPool._clients)) {
						let stalledCount = 0;
						for (let i = 0; i < internalPool._clients.length && stalledCount < count; i++) {
							const client = internalPool._clients[i];
							this.logger.debug(`Checking client at index ${i}: ${client?._ended}`);
							if (client && !client._ended && !client._ending) {
								// Mark the connection as ended but don't actually end it
								// This simulates a connection that's in a bad state but still in the pool
								client._ended = true;
								stalledCount++;
								this.logger.debug(`Marked connection ${i} as stalled`);
							}
						}
						return {
							success: stalledCount > 0,
							message:
								stalledCount > 0
									? `Simulated ${stalledCount} stalled connections`
									: 'No connections could be marked as stalled',
						};
					}
					return { success: false, message: 'Could not access internal pool structure' };

				default:
					return { success: false, message: `Unknown issue type: ${issueType as string}` };
			}
		} catch (error) {
			this.errorReporter.error(
				`Failed to simulate network issue: ${error instanceof Error ? error.message : String(error)}`,
			);
			return {
				success: false,
				message: `Error: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	recoverOnError() {
		if (!this.dataSource.isInitialized) return;
		if (this.dataSource.driver instanceof PostgresDriver) {
			this.logger.debug('Recovering Postgres connection pool');
			const pgDriver = this.dataSource.driver;
			const pgPool = pgDriver.master as Pool;
			pgPool.on('error', async (error) => {
				this.logger.debug(`Postgres pool error: ${ensureError(error).message}`);
				// Log the current pool state
				this.logger.debug(
					`Recovering connection pool. Total: ${pgPool.totalCount}, Idle: ${pgPool.idleCount}, Waiting: ${pgPool.waitingCount}`,
				);
				// Attempt to recover the connection pool
				const recoveryAttempted = await this.recoverConnectionPool(pgPool);
				if (recoveryAttempted) {
					this.logger.debug('Connection pool recovery attempted');
				} else {
					this.logger.debug('Failed to recover connection pool');
				}
			});
		}
	}

	/**
	 * Attempt to recover the connection pool when it's in an unhealthy state
	 * This method will try to release any stalled connections and create new ones
	 * @returns True if recovery was attempted, false otherwise
	 */
	private async recoverConnectionPool(pgPool: Pool): Promise<boolean> {
		if (!this.dataSource.isInitialized) {
			return false;
		}

		try {
			// Access the internal pool structure to find stalled connections
			// Note: This uses internal properties that are not part of the public API
			// but necessary for our specific use case of recovering from stalled connections
			const internalPool = pgPool as InternalPool;
			if (internalPool._clients && Array.isArray(internalPool._clients)) {
				this.logger.debug('Recovering connection pool...');
				let releasedCount = 0;
				const clients = internalPool._clients;

				for (let i = 0; i < clients.length; i++) {
					const client = clients[i];
					this.logger.debug(`Checking client at index ${i}: ${client?._ended}`);
					// Check if the client is in an ended state but still in the pool
					if (client && (client._ended === true || client._ending === true)) {
						// Properly release the client instead of just setting it to null
						this.logger.debug(`Found stalled connection at index ${i}, properly releasing it`);
						try {
							// Force release the client (true parameter forces termination)
							client.release(true);
						} catch (error) {
							// If release fails, manually remove it from the pool
							this.logger.debug(
								`Failed to release client, removing from pool: ${ensureError(error).message}`,
							);
							clients[i] = null;
						}
						releasedCount++;
					}
				}

				if (releasedCount > 0) {
					this.errorReporter.info(`Released ${releasedCount} stalled connections from the pool`);
				}
			}

			return true;
		} catch (error) {
			this.errorReporter.error(`Failed to recover connection pool: ${ensureError(error).message}`);
			return false;
		}
	}
}
