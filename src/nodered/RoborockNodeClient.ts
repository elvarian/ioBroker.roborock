import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { B01ControlService } from "../lib/features/vacuum/services/B01ControlService";
import { getB01VariantFromModel, type B01Variant } from "../lib/b01Variant";
import { http_api, type Device } from "../lib/httpApi";
import { local_api } from "../lib/localApi";
import { mqtt_api } from "../lib/mqttApi";
import { requestsHandler } from "../lib/requestsHandler";

type NodeRedLogger = {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
};

export type RoborockNodeClientOptions = {
	username: string;
	password?: string;
	region?: string;
	loginMethod?: "password" | "code";
	logger: NodeRedLogger;
};

type StoredState = { val: unknown; ack?: boolean };

type RoborockCommand = "start" | "pause" | "stop" | "dock" | "find" | "status" | "raw";

const V1_COMMANDS: Record<string, { method: string; params: unknown }> = {
	start: { method: "app_start", params: [] },
	pause: { method: "app_pause", params: [] },
	stop: { method: "app_stop", params: [] },
	dock: { method: "app_charge", params: [] },
	find: { method: "find_me", params: [] },
	status: { method: "get_prop", params: ["get_status"] },
};

const B01_STATUS_PROPS = [
	"status",
	"battery",
	"error_code",
	"clean_time",
	"clean_area",
	"cleaning_time",
	"cleaning_area",
	"dock_status",
	"water",
	"wind",
];

const Q10_DP_COMMANDS: Record<string, Record<string, unknown>> = {
	start: { "201": { cmd: 1 } },
	pause: { "204": 0 },
	stop: { "206": 0 },
	dock: { "202": 5 },
};

export class RoborockNodeClient extends EventEmitter {
	public readonly config: Record<string, unknown>;
	public readonly instance = 0;
	public readonly namespace = "node-red.roborock";
	public readonly language = "en";
	public readonly translations: Record<string, string> = {};
	public readonly nonce = randomBytes(16);
	public readonly pendingRequests = new Map<number, any>();
	public readonly b01MapResponseQueue = new Map<string, Array<"get_map_v1" | "get_clean_record_map">>();
	public readonly deviceFeatureHandlers = new Map<string, any>();
	public readonly deviceManager = { deviceFeatureHandlers: this.deviceFeatureHandlers };
	public readonly mapManager = { updateB01DeviceStatus: () => {} };
	public readonly translationManager = { get: (key: string) => key };

	public readonly http_api: http_api;
	public readonly local_api: local_api;
	public readonly mqtt_api: mqtt_api;
	public readonly requestsHandler: requestsHandler;

	private readonly logger: NodeRedLogger;
	private readonly stateStore = new Map<string, StoredState>();
	private readyPromise: Promise<void> | null = null;
	private readonly b01ControlService = new B01ControlService();

	constructor(options: RoborockNodeClientOptions) {
		super();
		this.logger = options.logger;
		this.config = {
			username: options.username,
			password: options.password || "",
			region: options.region || "eu",
			loginMethod: options.loginMethod || (options.password ? "password" : "code"),
			enable_map_creation: false,
		};

		this.http_api = new http_api(this as any);
		this.local_api = new local_api(this as any);
		this.mqtt_api = new mqtt_api(this as any);
		this.requestsHandler = new requestsHandler(this as any);
	}

	public async connect(): Promise<void> {
		if (!this.readyPromise) {
			this.readyPromise = this.connectInternal().catch((error: unknown) => {
				this.readyPromise = null;
				throw error;
			});
		}
		return this.readyPromise;
	}

	private async connectInternal(): Promise<void> {
		if (!this.config.username) {
			throw new Error("Roborock username is missing");
		}

		const clientId = "node-red-roborock";
		await this.http_api.init(clientId);
		await this.http_api.updateHomeData();
		await this.mqtt_api.init();
		this.emit("connected");
	}

	public getDevices(): Device[] {
		return this.http_api.getDevices();
	}

	public getDeviceSummaries(): Array<{ duid: string; name?: string; pv: string; online: boolean; hasLocalKey: boolean; productId: string }> {
		return this.getDevices().map((device) => ({
			duid: device.duid,
			name: device.name,
			pv: device.pv,
			online: device.online,
			hasLocalKey: !!device.localKey,
			productId: device.productId,
		}));
	}

	public async execute(command: RoborockCommand | string, duid: string, params?: unknown): Promise<unknown> {
		await this.connect();
		if (!duid && command !== "devices") {
			throw new Error("Roborock device id (duid) is missing");
		}

		if (command === "devices") {
			return this.getDeviceSummaries();
		}

		const device = this.getDeviceOrThrow(duid);
		const protocol = await this.getDeviceProtocolVersion(duid);
		const variant = await this.getB01Variant(duid);
		const normalized = String(command || "raw").toLowerCase();
		if (!device.localKey) {
			throw new Error(`Roborock device '${duid}' has no localKey in HomeData; cannot send encrypted commands. Check the DUID with action 'devices' and use the owning Roborock account if this is a shared device.`);
		}

		if (normalized === "raw") {
			const raw = this.normalizeRawParams(params);
			return this.requestsHandler.sendRequest(duid, raw.method, raw.params);
		}

		if (protocol === "B01" && variant === "Q10" && Q10_DP_COMMANDS[normalized]) {
			await this.requestsHandler.publishB01Dp(duid, Q10_DP_COMMANDS[normalized]);
			return { ok: true };
		}

		if (protocol === "B01") {
			return this.executeB01Command(normalized, duid, params);
		}

		const mapped = V1_COMMANDS[normalized];
		if (!mapped) {
			throw new Error(`Unsupported command '${command}'. Use 'raw' for custom Roborock methods.`);
		}
		return this.requestsHandler.sendRequest(duid, mapped.method, params ?? mapped.params);
	}

	private async executeB01Command(command: string, duid: string, params?: unknown): Promise<unknown> {
		if (command === "status") {
			return this.requestsHandler.sendRequest(duid, "prop.get", { property: B01_STATUS_PROPS });
		}

		const adapterMethod = command === "dock" ? "app_charge" : command === "find" ? "find_me" : `app_${command}`;
		const mapped = this.b01ControlService.getCommandParams(adapterMethod, params);
		if (
			typeof mapped === "object"
			&& mapped !== null
			&& "method" in mapped
			&& "params" in mapped
		) {
			const commandSpec = mapped as { method: string; params: unknown };
			return this.requestsHandler.sendRequest(duid, commandSpec.method, commandSpec.params);
		}
		throw new Error(`Unsupported B01 command '${command}'. Use 'raw' for custom Roborock methods.`);
	}

	private getDeviceOrThrow(duid: string): Device {
		const devices = this.getDevices();
		const device = devices.find((item) => item.duid === duid);
		if (!device) {
			const knownDevices = devices.map((item) => `${item.name || "unnamed"} (${item.duid})`).join(", ") || "none";
			throw new Error(`Roborock device '${duid}' was not found in HomeData. Known devices: ${knownDevices}`);
		}
		return device;
	}

	private normalizeRawParams(params: unknown): { method: string; params: unknown } {
		if (typeof params !== "object" || params === null) {
			throw new Error("Raw command expects msg.payload = { method, params }");
		}
		const payload = params as { method?: unknown; params?: unknown };
		if (typeof payload.method !== "string" || !payload.method) {
			throw new Error("Raw command payload.method is required");
		}
		return { method: payload.method, params: payload.params ?? [] };
	}

	public async getDeviceProtocolVersion(duid: string): Promise<string> {
		const device = this.http_api.getDevices().find((item) => item.duid === duid);
		return device?.pv || "1.0";
	}

	public async getB01Variant(duid: string): Promise<B01Variant | null> {
		const protocol = await this.getDeviceProtocolVersion(duid);
		if (protocol !== "B01") return null;
		const model = this.http_api.getRobotModel(duid);
		return model ? getB01VariantFromModel(model) : "Q7";
	}

	public async processA01(_duid: string, response: { dps?: Record<string, unknown> }): Promise<void> {
		this.emit("state", response);
	}

	public async checkForNewFirmware(): Promise<void> {}

	public rLog(
		connection: string,
		duid: string | null | undefined,
		direction: string,
		version: string | undefined,
		protocol: string | number | undefined,
		message: string,
		level: "debug" | "info" | "warn" | "error" = "debug"
	): void {
		const parts = [`[${connection}]`];
		if (duid) parts.push(`[${duid}]`);
		if (version) parts.push(`[${version}]`);
		if (protocol) parts.push(`[${protocol}]`);
		parts.push(direction, message);
		this.logger[level](parts.join(" "));
	}

	public setTimeout(callback: (...args: unknown[]) => void, ms?: number): NodeJS.Timeout {
		return setTimeout(callback, ms);
	}

	public clearTimeout(timer: NodeJS.Timeout): void {
		clearTimeout(timer);
	}

	public setInterval(callback: (...args: unknown[]) => void, ms?: number): NodeJS.Timeout {
		return setInterval(callback, ms);
	}

	public clearInterval(timer: NodeJS.Timeout): void {
		clearInterval(timer);
	}

	public async getStateAsync(id: string): Promise<StoredState | null> {
		return this.stateStore.get(id) ?? null;
	}

	public async setState(id: string, state: StoredState): Promise<void> {
		this.stateStore.set(id, state);
	}

	public async setStateChanged(id: string, state: StoredState): Promise<void> {
		this.stateStore.set(id, state);
	}

	public async ensureState(): Promise<void> {}
	public async ensureFolder(): Promise<void> {}
	public async extendObject(): Promise<void> {}
	public async getObjectAsync(): Promise<null> { return null; }
	public async getStatesAsync(): Promise<Record<string, StoredState>> { return {}; }
	public async getForeignStatesAsync(): Promise<Record<string, StoredState>> { return {}; }
	public async setObjectNotExistsAsync(): Promise<void> {}
	public async subscribeStatesAsync(): Promise<void> {}
	public async unsubscribeStatesAsync(): Promise<void> {}

	public errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	public errorStack(error: unknown): string {
		return error instanceof Error ? error.stack ?? error.message : String(error);
	}

	public async catchError(error: unknown, attribute?: string, duid?: string): Promise<void> {
		this.rLog("System", duid, "Error", undefined, undefined, `${attribute || "task"}: ${this.errorStack(error)}`, "error");
	}

	public formatRoborockDate(timestamp: number): string {
		return new Date(timestamp * 1000).toLocaleString();
	}

	public async close(): Promise<void> {
		this.requestsHandler.clearQueue();
		this.mqtt_api.cleanup();
		this.local_api.stopUdpDiscovery();
		this.local_api.stopTcpKeepaliveInterval();
		this.readyPromise = null;
		this.emit("disconnected");
	}
}
