/**
 * SSH tRPC Router
 *
 * CRUD operations for SSH connection profiles and ~/.ssh/config parsing.
 */

import { settings, sshConnectionSchema, type SSHConnection } from "@superset/local-db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { localDb } from "main/lib/local-db";
import { getSSHConfigHosts } from "main/lib/terminal/ssh/ssh-config";
import { getSSHTerminalManager } from "main/lib/terminal/ssh/ssh-manager";
import { publicProcedure, router } from "../../trpc";

function getSSHConnections(): SSHConnection[] {
	const row = localDb
		.select({ sshConnections: settings.sshConnections })
		.from(settings)
		.where(eq(settings.id, 1))
		.get();
	return (row?.sshConnections as SSHConnection[]) ?? [];
}

function saveSSHConnections(connections: SSHConnection[]): void {
	localDb
		.update(settings)
		.set({ sshConnections: connections })
		.where(eq(settings.id, 1))
		.run();
}

export const sshRouter = router({
	/** List all saved SSH connection profiles */
	list: publicProcedure.query(() => {
		return getSSHConnections();
	}),

	/** Get a single SSH connection by ID */
	get: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => {
			const connections = getSSHConnections();
			return connections.find((c) => c.id === input.id) ?? null;
		}),

	/** Create a new SSH connection profile */
	create: publicProcedure
		.input(sshConnectionSchema)
		.mutation(({ input }) => {
			const connections = getSSHConnections();
			// Ensure no duplicate ID
			const existing = connections.findIndex((c) => c.id === input.id);
			if (existing >= 0) {
				connections[existing] = input;
			} else {
				connections.push(input);
			}
			saveSSHConnections(connections);
			return input;
		}),

	/** Update an SSH connection profile */
	update: publicProcedure
		.input(
			z.object({
				id: z.string(),
				data: sshConnectionSchema.partial(),
			}),
		)
		.mutation(({ input }) => {
			const connections = getSSHConnections();
			const idx = connections.findIndex((c) => c.id === input.id);
			if (idx < 0) {
				throw new Error(`SSH connection ${input.id} not found`);
			}
			connections[idx] = { ...connections[idx], ...input.data };
			saveSSHConnections(connections);
			return connections[idx];
		}),

	/** Delete an SSH connection profile */
	delete: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => {
			const connections = getSSHConnections();
			const filtered = connections.filter((c) => c.id !== input.id);
			saveSSHConnections(filtered);
			return { success: true };
		}),

	/** Test an SSH connection (try to connect and immediately disconnect) */
	testConnection: publicProcedure
		.input(sshConnectionSchema)
		.mutation(async ({ input }) => {
			const { Client } = await import("ssh2");
			const { readFileSync } = await import("node:fs");
			const { resolve } = await import("node:path");
			const os = await import("node:os");

			return new Promise<{ success: boolean; error?: string }>(
				(resolveResult) => {
					const client = new Client();
					const timeout = setTimeout(() => {
						client.end();
						resolveResult({
							success: false,
							error: "Connection timed out",
						});
					}, 15_000);

					client.on("ready", () => {
						clearTimeout(timeout);
						client.end();
						resolveResult({ success: true });
					});

					client.on("error", (err) => {
						clearTimeout(timeout);
						resolveResult({
							success: false,
							error: err.message,
						});
					});

					const config: Record<string, unknown> = {
						host: input.host,
						port: input.port,
						username: input.username,
						readyTimeout: 15_000,
					};

					if (input.authMethod === "key" && input.privateKeyPath) {
						let keyPath = input.privateKeyPath;
						if (keyPath.startsWith("~")) {
							keyPath = resolve(os.homedir(), keyPath.slice(2));
						}
						try {
							config.privateKey = readFileSync(keyPath);
						} catch (err) {
							clearTimeout(timeout);
							resolveResult({
								success: false,
								error: `Cannot read key: ${err instanceof Error ? err.message : String(err)}`,
							});
							return;
						}
					} else if (input.authMethod === "agent") {
						if (process.env.SSH_AUTH_SOCK) {
							config.agent = process.env.SSH_AUTH_SOCK;
						} else {
							clearTimeout(timeout);
							resolveResult({
								success: false,
								error: "SSH_AUTH_SOCK not set",
							});
							return;
						}
					}

					client.connect(config);
				},
			);
		}),

	/** List SSH hosts from ~/.ssh/config */
	listConfigHosts: publicProcedure.query(() => {
		return getSSHConfigHosts();
	}),

	/** Get SSH manager stats */
	stats: publicProcedure.query(() => {
		const manager = getSSHTerminalManager();
		return {
			activeSessions: manager.getSessionCount(),
		};
	}),
});
