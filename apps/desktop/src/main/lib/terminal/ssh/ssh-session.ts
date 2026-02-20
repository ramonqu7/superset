/**
 * SSH Terminal Session
 *
 * Creates a PTY-over-SSH session using the ssh2 library.
 * Mirrors the interface of the local terminal session for seamless integration.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import type { SSHConnectionConfig, SSHSessionInfo } from "./types";

const DEBUG_SSH = process.env.SUPERSET_SSH_DEBUG === "1";

export interface SSHSessionParams {
	paneId: string;
	workspaceId: string;
	connection: SSHConnectionConfig;
	cols: number;
	rows: number;
	cwd?: string;
	initialCommands?: string[];
}

export interface SSHSession {
	info: SSHSessionInfo;
	client: Client;
	stream: ClientChannel | null;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): Promise<void>;
	dispose(): void;
}

function resolveKeyPath(keyPath: string): string {
	if (keyPath.startsWith("~")) {
		return resolve(os.homedir(), keyPath.slice(2));
	}
	return resolve(keyPath);
}

function buildConnectConfig(connection: SSHConnectionConfig): ConnectConfig {
	const config: ConnectConfig = {
		host: connection.host,
		port: connection.port,
		username: connection.username,
		keepaliveInterval: connection.keepAliveIntervalMs ?? 10_000,
		keepaliveCountMax: 3,
		readyTimeout: 30_000,
	};

	if (connection.agentForwarding) {
		config.agentForward = true;
		// Use SSH_AUTH_SOCK for agent auth
		if (process.env.SSH_AUTH_SOCK) {
			config.agent = process.env.SSH_AUTH_SOCK;
		}
	}

	switch (connection.authMethod) {
		case "key": {
			if (connection.privateKeyPath) {
				const keyPath = resolveKeyPath(connection.privateKeyPath);
				try {
					config.privateKey = readFileSync(keyPath);
				} catch (err) {
					throw new Error(
						`[SSH] Failed to read private key at ${keyPath}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				if (connection.passphrase) {
					config.passphrase = connection.passphrase;
				}
			}
			break;
		}
		case "password": {
			if (connection.password) {
				config.password = connection.password;
			}
			break;
		}
		case "agent": {
			// SSH agent auth - use SSH_AUTH_SOCK
			if (process.env.SSH_AUTH_SOCK) {
				config.agent = process.env.SSH_AUTH_SOCK;
			} else {
				throw new Error(
					"[SSH] Agent auth requested but SSH_AUTH_SOCK is not set",
				);
			}
			break;
		}
	}

	return config;
}

export async function createSSHSession(
	params: SSHSessionParams,
	onData: (paneId: string, data: string) => void,
	onExit: (paneId: string, exitCode: number, signal?: string) => void,
	onError: (paneId: string, error: string) => void,
): Promise<SSHSession> {
	const {
		paneId,
		workspaceId,
		connection,
		cols,
		rows,
		cwd,
		initialCommands,
	} = params;

	if (DEBUG_SSH) {
		console.log("[SSH] Creating session:", {
			paneId,
			host: connection.host,
			port: connection.port,
			username: connection.username,
			authMethod: connection.authMethod,
		});
	}

	const client = new Client();
	const connectConfig = buildConnectConfig(connection);

	const info: SSHSessionInfo = {
		paneId,
		workspaceId,
		connectionId: connection.id,
		isAlive: false,
		lastActive: Date.now(),
		cwd: cwd || "~",
		cols,
		rows,
	};

	let stream: ClientChannel | null = null;

	return new Promise<SSHSession>((resolveSession, rejectSession) => {
		const connectionTimeout = setTimeout(() => {
			client.end();
			rejectSession(
				new Error(
					`[SSH] Connection to ${connection.host}:${connection.port} timed out`,
				),
			);
		}, 30_000);

		client.on("ready", () => {
			clearTimeout(connectionTimeout);
			if (DEBUG_SSH) {
				console.log(
					`[SSH] Connected to ${connection.host}:${connection.port}`,
				);
			}

			client.shell(
				{
					term: "xterm-256color",
					cols,
					rows,
				},
				(err, shellStream) => {
					if (err) {
						rejectSession(
							new Error(`[SSH] Failed to open shell: ${err.message}`),
						);
						return;
					}

					stream = shellStream;
					info.isAlive = true;

					shellStream.on("data", (data: Buffer) => {
						info.lastActive = Date.now();
						onData(paneId, data.toString("utf-8"));
					});

					shellStream.stderr.on("data", (data: Buffer) => {
						info.lastActive = Date.now();
						onData(paneId, data.toString("utf-8"));
					});

					shellStream.on("close", () => {
						if (DEBUG_SSH) {
							console.log(`[SSH] Shell closed for ${paneId}`);
						}
						info.isAlive = false;
						info.exitReason = "exited";
						onExit(paneId, 0);
					});

					shellStream.on("error", (shellErr: Error) => {
						console.error(`[SSH] Shell error for ${paneId}:`, shellErr);
						info.isAlive = false;
						info.exitReason = "error";
						onError(paneId, shellErr.message);
					});

					// cd to working directory if specified
					if (cwd && cwd !== "~") {
						shellStream.write(`cd ${JSON.stringify(cwd)}\n`);
					}

					// Send initial commands after a short delay for shell init
					if (initialCommands && initialCommands.length > 0) {
						setTimeout(() => {
							if (info.isAlive && stream) {
								const cmdString = `${initialCommands.join(" && ")}\n`;
								stream.write(cmdString);
							}
						}, 500);
					}

					const session: SSHSession = {
						info,
						client,
						stream,
						write(data: string) {
							if (stream && info.isAlive) {
								stream.write(data);
								info.lastActive = Date.now();
							}
						},
						resize(newCols: number, newRows: number) {
							if (stream && info.isAlive) {
								stream.setWindow(newRows, newCols, 0, 0);
								info.cols = newCols;
								info.rows = newRows;
							}
						},
						async kill() {
							if (DEBUG_SSH) {
								console.log(`[SSH] Killing session ${paneId}`);
							}
							info.isAlive = false;
							info.exitReason = "killed";
							if (stream) {
								stream.close();
								stream = null;
							}
							client.end();
						},
						dispose() {
							info.isAlive = false;
							if (stream) {
								stream.destroy();
								stream = null;
							}
							client.destroy();
						},
					};

					resolveSession(session);
				},
			);
		});

		client.on("error", (err) => {
			clearTimeout(connectionTimeout);
			console.error(`[SSH] Connection error for ${paneId}:`, err);
			info.isAlive = false;
			info.exitReason = "disconnected";
			onError(paneId, `SSH connection error: ${err.message}`);
			rejectSession(
				new Error(`[SSH] Connection failed: ${err.message}`),
			);
		});

		client.on("close", () => {
			if (DEBUG_SSH) {
				console.log(`[SSH] Connection closed for ${paneId}`);
			}
			if (info.isAlive) {
				info.isAlive = false;
				info.exitReason = "disconnected";
				onExit(paneId, 255, "SIGHUP");
			}
		});

		client.on("end", () => {
			if (DEBUG_SSH) {
				console.log(`[SSH] Connection ended for ${paneId}`);
			}
		});

		client.connect(connectConfig);
	});
}
