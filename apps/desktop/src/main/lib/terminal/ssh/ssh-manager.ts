/**
 * SSH Terminal Manager
 *
 * Manages multiple SSH terminal sessions. Provides the same event-based
 * interface as the local DaemonTerminalManager for seamless integration.
 */

import { EventEmitter } from "node:events";
import {
	createSSHSession,
	type SSHSession,
	type SSHSessionParams,
} from "./ssh-session";
import type { SSHConnectionConfig, SSHSessionInfo } from "./types";

const DEBUG_SSH = process.env.SUPERSET_SSH_DEBUG === "1";

export class SSHTerminalManager extends EventEmitter {
	private sessions = new Map<string, SSHSession>();

	constructor() {
		super();
	}

	async createSession(params: SSHSessionParams): Promise<{
		isNew: boolean;
		info: SSHSessionInfo;
	}> {
		// Kill existing session for this pane if any
		const existing = this.sessions.get(params.paneId);
		if (existing) {
			if (DEBUG_SSH) {
				console.log(
					`[SSH Manager] Killing existing session for pane ${params.paneId}`,
				);
			}
			await existing.kill();
			this.sessions.delete(params.paneId);
		}

		const session = await createSSHSession(
			params,
			(paneId, data) => {
				this.emit(`data:${paneId}`, data);
			},
			(paneId, exitCode, signal) => {
				this.emit(`exit:${paneId}`, { exitCode, signal });
				this.emit("terminalExit", {
					paneId,
					exitCode,
					signal,
				});
			},
			(paneId, error) => {
				this.emit(`error:${paneId}`, { error });
			},
		);

		this.sessions.set(params.paneId, session);

		return {
			isNew: true,
			info: session.info,
		};
	}

	write(paneId: string, data: string): void {
		const session = this.sessions.get(paneId);
		if (session) {
			session.write(data);
		}
	}

	resize(paneId: string, cols: number, rows: number): void {
		const session = this.sessions.get(paneId);
		if (session) {
			session.resize(cols, rows);
		}
	}

	async kill(paneId: string): Promise<void> {
		const session = this.sessions.get(paneId);
		if (session) {
			await session.kill();
			this.sessions.delete(paneId);
		}
	}

	async killByWorkspaceId(
		workspaceId: string,
	): Promise<{ killed: number; failed: number }> {
		let killed = 0;
		let failed = 0;

		for (const [paneId, session] of this.sessions) {
			if (session.info.workspaceId === workspaceId) {
				try {
					await session.kill();
					this.sessions.delete(paneId);
					killed++;
				} catch {
					failed++;
				}
			}
		}

		return { killed, failed };
	}

	getSession(paneId: string): SSHSessionInfo | null {
		const session = this.sessions.get(paneId);
		return session?.info ?? null;
	}

	isSSHSession(paneId: string): boolean {
		return this.sessions.has(paneId);
	}

	getSessionCount(): number {
		return this.sessions.size;
	}

	getSessionCountByWorkspaceId(workspaceId: string): number {
		let count = 0;
		for (const session of this.sessions.values()) {
			if (session.info.workspaceId === workspaceId) {
				count++;
			}
		}
		return count;
	}

	async cleanup(): Promise<void> {
		if (DEBUG_SSH) {
			console.log(
				`[SSH Manager] Cleaning up ${this.sessions.size} sessions`,
			);
		}
		const promises: Promise<void>[] = [];
		for (const [paneId, session] of this.sessions) {
			promises.push(
				session.kill().catch((err) => {
					console.error(
						`[SSH Manager] Error killing session ${paneId}:`,
						err,
					);
				}),
			);
		}
		await Promise.all(promises);
		this.sessions.clear();
	}
}

/** Singleton SSH manager instance */
let sshManager: SSHTerminalManager | null = null;

export function getSSHTerminalManager(): SSHTerminalManager {
	if (!sshManager) {
		sshManager = new SSHTerminalManager();
	}
	return sshManager;
}
