/**
 * SSH Config Parser
 *
 * Reads and parses ~/.ssh/config to discover available SSH hosts.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import SSHConfig from "ssh-config";
import type { SSHConnectionConfig } from "./types";

const SSH_CONFIG_PATH = join(os.homedir(), ".ssh", "config");

export interface ParsedSSHHost {
	name: string;
	hostname: string;
	port: number;
	user: string;
	identityFile?: string;
	forwardAgent: boolean;
}

/**
 * Parse ~/.ssh/config and return a list of configured hosts.
 */
export function parseSSHConfig(): ParsedSSHHost[] {
	if (!existsSync(SSH_CONFIG_PATH)) {
		return [];
	}

	try {
		const configContent = readFileSync(SSH_CONFIG_PATH, "utf-8");
		const config = SSHConfig.parse(configContent);
		const hosts: ParsedSSHHost[] = [];

		for (const section of config) {
			if (section.type !== SSHConfig.DIRECTIVE) continue;
			if (section.param !== "Host") continue;

			const hostPattern = section.value as string;

			// Skip wildcard patterns
			if (hostPattern.includes("*") || hostPattern.includes("?")) {
				continue;
			}

			const computed = config.compute(hostPattern);
			const hostname =
				(computed.HostName as string) || hostPattern;
			const port = Number.parseInt(
				(computed.Port as string) || "22",
				10,
			);
			const user = (computed.User as string) || os.userInfo().username;
			const identityFile = computed.IdentityFile as string | undefined;
			const forwardAgent =
				(computed.ForwardAgent as string)?.toLowerCase() === "yes";

			hosts.push({
				name: hostPattern,
				hostname,
				port,
				user,
				identityFile: Array.isArray(identityFile)
					? identityFile[0]
					: identityFile,
				forwardAgent,
			});
		}

		return hosts;
	} catch (err) {
		console.error(
			"[SSH Config] Failed to parse ~/.ssh/config:",
			err instanceof Error ? err.message : String(err),
		);
		return [];
	}
}

/**
 * Convert a parsed SSH host into an SSHConnectionConfig.
 */
export function sshHostToConnectionConfig(
	host: ParsedSSHHost,
): SSHConnectionConfig {
	const authMethod = host.identityFile
		? "key"
		: process.env.SSH_AUTH_SOCK
			? "agent"
			: "password";

	return {
		id: `ssh-config-${host.name}`,
		name: host.name,
		host: host.hostname,
		port: host.port,
		username: host.user,
		authMethod,
		privateKeyPath: host.identityFile,
		agentForwarding: host.forwardAgent,
	};
}

/**
 * Get all SSH hosts from ~/.ssh/config as connection configs.
 */
export function getSSHConfigHosts(): SSHConnectionConfig[] {
	return parseSSHConfig().map(sshHostToConnectionConfig);
}
