import type { RoborockNodeClientOptions } from "./RoborockNodeClient";
import { RoborockNodeClient } from "./RoborockNodeClient";

type NodeRedRuntime = {
	nodes: {
		createNode(node: NodeRedNode, config: Record<string, unknown>): void;
		registerType(type: string, constructor: new (config: Record<string, unknown>) => NodeRedNode, options?: Record<string, unknown>): void;
		getNode(id: string): RoborockConfigNode | null;
	};
};

type NodeRedNode = {
	id: string;
	credentials?: Record<string, string>;
	log(message: string): void;
	debug(message: string): void;
	warn(message: string): void;
	error(message: string | Error, msg?: unknown): void;
	status(status: Record<string, string>): void;
	on(event: string, callback: (...args: any[]) => void): void;
	send(msg: unknown): void;
};

type RoborockConfigNode = NodeRedNode & {
	client: RoborockNodeClient;
	getClient(): Promise<RoborockNodeClient>;
	closeClient(done?: () => void): void;
};

function payloadCommand(msg: any, configuredAction: string): string {
	const messageAction = String(msg.action || msg.command || msg.topic || "").toLowerCase();
	if (messageAction === "login-code") return messageAction;
	return String(configuredAction || msg.action || msg.command || msg.topic || "status").toLowerCase();
}

function payloadParams(msg: any, action: string): unknown {
	if (action === "raw") return msg.payload;
	if (Object.prototype.hasOwnProperty.call(msg, "params")) return msg.params;
	return undefined;
}

function payloadDuid(msg: any, configuredDuid: string): string {
	return String(configuredDuid || msg.duid || msg.device || msg.deviceId || "");
}

module.exports = function registerRoborockNodes(RED: NodeRedRuntime): void {
	class RoborockConfig {
		public id!: string;
		public credentials?: Record<string, string>;
		public client!: RoborockNodeClient;

		constructor(config: Record<string, unknown>) {
			RED.nodes.createNode(this as unknown as NodeRedNode, config);
			const node = this as unknown as RoborockConfigNode;
			const options: RoborockNodeClientOptions = {
				username: String(node.credentials?.username || ""),
				password: node.credentials?.password || "",
				region: String(config.region || "eu"),
				loginMethod: String(config.loginMethod || "password") as "password" | "code",
				logger: {
					debug: (message) => node.debug(message),
					info: (message) => node.log(message),
					warn: (message) => node.warn(message),
					error: (message) => node.error(message),
				},
			};
			this.client = new RoborockNodeClient(options);

			node.getClient = async () => {
				await this.client.connect();
				return this.client;
			};
			node.closeClient = (done?: () => void) => {
				this.client.close()
					.catch((error: unknown) => node.error(error instanceof Error ? error : String(error)))
					.finally(() => done?.());
			};
			node.on("close", (_removed: boolean, done: () => void) => node.closeClient(done));
		}
	}

	class RoborockCommandNode {
		constructor(config: Record<string, unknown>) {
			RED.nodes.createNode(this as unknown as NodeRedNode, config);
			const node = this as unknown as NodeRedNode;
			const connection = RED.nodes.getNode(String(config.connection || "")) as RoborockConfigNode | null;
			const configuredAction = String(config.action || "");
			const configuredDuid = String(config.duid || "");

			node.on("input", async (msg: any, send?: (msg: unknown) => void, done?: (error?: Error) => void) => {
				const nodeSend = send || ((out: unknown) => node.send(out));
				if (!connection) {
					const error = new Error("Roborock connection is not configured");
					node.status({ fill: "red", shape: "ring", text: "not configured" });
					done ? done(error) : node.error(error, msg);
					return;
				}

				const action = payloadCommand(msg, configuredAction);
				const duid = payloadDuid(msg, configuredDuid);
				const params = payloadParams(msg, action);

				try {
					if (action === "login-code") {
						const code = String(msg.payload?.code || msg.payload || "");
						const result = connection.client.http_api.submitLoginCode(code);
						if (!result.accepted) {
							throw new Error("Login code must be a 6-digit code");
						}
						msg.payload = { ok: true, delivered: result.delivered, queued: !result.delivered };
						node.status({ fill: "green", shape: "dot", text: result.delivered ? "code sent" : "code queued" });
						nodeSend(msg);
						done?.();
						return;
					}
					node.status({ fill: "yellow", shape: "dot", text: action });
					const client = await connection.getClient();
					const result = await client.execute(action, duid, params);
					msg.payload = result;
					msg.roborock = { action, duid };
					node.status({ fill: "green", shape: "dot", text: "ok" });
					nodeSend(msg);
					done?.();
				} catch (error: unknown) {
					const err = error instanceof Error ? error : new Error(String(error));
					node.status({ fill: "red", shape: "ring", text: err.message });
					done ? done(err) : node.error(err, msg);
				}
			});
		}
	}

	RED.nodes.registerType("roborock-config", RoborockConfig as any, {
		credentials: {
			username: { type: "text" },
			password: { type: "password" },
		},
	});
	RED.nodes.registerType("roborock", RoborockCommandNode as any);
};
