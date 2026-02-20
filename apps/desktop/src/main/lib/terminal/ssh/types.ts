/**
 * SSH Terminal Types
 *
 * Connection configuration and session info for SSH-based terminals.
 */

export type SSHAuthMethod = "key" | "password" | "agent";

export interface SSHConnectionConfig {
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	authMethod: SSHAuthMethod;
	/** Path to private key file (for key auth) */
	privateKeyPath?: string;
	/** Passphrase for encrypted private keys */
	passphrase?: string;
	/** Password (for password auth) */
	password?: string;
	/** Enable SSH agent forwarding */
	agentForwarding: boolean;
	/** Keep-alive interval in milliseconds (default: 10000) */
	keepAliveIntervalMs?: number;
}

export interface SSHSessionInfo {
	paneId: string;
	workspaceId: string;
	connectionId: string;
	isAlive: boolean;
	lastActive: number;
	cwd: string;
	cols: number;
	rows: number;
	exitReason?: "killed" | "exited" | "error" | "disconnected";
}
