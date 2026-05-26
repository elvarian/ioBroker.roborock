"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoborockNodeClient = void 0;
const node_events_1 = require("node:events");
const node_crypto_1 = require("node:crypto");
const B01ControlService_1 = require("../lib/features/vacuum/services/B01ControlService");
const b01Variant_1 = require("../lib/b01Variant");
const httpApi_1 = require("../lib/httpApi");
const localApi_1 = require("../lib/localApi");
const mqttApi_1 = require("../lib/mqttApi");
const requestsHandler_1 = require("../lib/requestsHandler");
const V1_COMMANDS = {
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
const Q10_DP_COMMANDS = {
    start: { "201": { cmd: 1 } },
    pause: { "204": 0 },
    stop: { "206": 0 },
    dock: { "202": 5 },
};
class RoborockNodeClient extends node_events_1.EventEmitter {
    config;
    instance = 0;
    namespace = "node-red.roborock";
    language = "en";
    translations = {};
    nonce = (0, node_crypto_1.randomBytes)(16);
    pendingRequests = new Map();
    b01MapResponseQueue = new Map();
    deviceFeatureHandlers = new Map();
    deviceManager = { deviceFeatureHandlers: this.deviceFeatureHandlers };
    mapManager = { updateB01DeviceStatus: () => { } };
    translationManager = { get: (key) => key };
    http_api;
    local_api;
    mqtt_api;
    requestsHandler;
    logger;
    stateStore = new Map();
    readyPromise = null;
    b01ControlService = new B01ControlService_1.B01ControlService();
    constructor(options) {
        super();
        this.logger = options.logger;
        this.config = {
            username: options.username,
            password: options.password || "",
            region: options.region || "eu",
            loginMethod: options.loginMethod || (options.password ? "password" : "code"),
            enable_map_creation: false,
        };
        this.http_api = new httpApi_1.http_api(this);
        this.local_api = new localApi_1.local_api(this);
        this.mqtt_api = new mqttApi_1.mqtt_api(this);
        this.requestsHandler = new requestsHandler_1.requestsHandler(this);
    }
    async connect() {
        if (!this.readyPromise) {
            this.readyPromise = this.connectInternal().catch((error) => {
                this.readyPromise = null;
                throw error;
            });
        }
        return this.readyPromise;
    }
    async connectInternal() {
        if (!this.config.username) {
            throw new Error("Roborock username is missing");
        }
        const clientId = "node-red-roborock";
        await this.http_api.init(clientId);
        await this.http_api.updateHomeData();
        await this.mqtt_api.init();
        this.emit("connected");
    }
    getDevices() {
        return this.http_api.getDevices();
    }
    async execute(command, duid, params) {
        await this.connect();
        if (!duid && command !== "devices") {
            throw new Error("Roborock device id (duid) is missing");
        }
        if (command === "devices") {
            return this.getDevices();
        }
        const protocol = await this.getDeviceProtocolVersion(duid);
        const variant = await this.getB01Variant(duid);
        const normalized = String(command || "raw").toLowerCase();
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
    async executeB01Command(command, duid, params) {
        if (command === "status") {
            return this.requestsHandler.sendRequest(duid, "prop.get", { property: B01_STATUS_PROPS });
        }
        const adapterMethod = command === "dock" ? "app_charge" : command === "find" ? "find_me" : `app_${command}`;
        const mapped = this.b01ControlService.getCommandParams(adapterMethod, params);
        if (typeof mapped === "object"
            && mapped !== null
            && "method" in mapped
            && "params" in mapped) {
            const commandSpec = mapped;
            return this.requestsHandler.sendRequest(duid, commandSpec.method, commandSpec.params);
        }
        throw new Error(`Unsupported B01 command '${command}'. Use 'raw' for custom Roborock methods.`);
    }
    normalizeRawParams(params) {
        if (typeof params !== "object" || params === null) {
            throw new Error("Raw command expects msg.payload = { method, params }");
        }
        const payload = params;
        if (typeof payload.method !== "string" || !payload.method) {
            throw new Error("Raw command payload.method is required");
        }
        return { method: payload.method, params: payload.params ?? [] };
    }
    async getDeviceProtocolVersion(duid) {
        const device = this.http_api.getDevices().find((item) => item.duid === duid);
        return device?.pv || "1.0";
    }
    async getB01Variant(duid) {
        const protocol = await this.getDeviceProtocolVersion(duid);
        if (protocol !== "B01")
            return null;
        const model = this.http_api.getRobotModel(duid);
        return model ? (0, b01Variant_1.getB01VariantFromModel)(model) : "Q7";
    }
    async processA01(_duid, response) {
        this.emit("state", response);
    }
    async checkForNewFirmware() { }
    rLog(connection, duid, direction, version, protocol, message, level = "debug") {
        const parts = [`[${connection}]`];
        if (duid)
            parts.push(`[${duid}]`);
        if (version)
            parts.push(`[${version}]`);
        if (protocol)
            parts.push(`[${protocol}]`);
        parts.push(direction, message);
        this.logger[level](parts.join(" "));
    }
    setTimeout(callback, ms) {
        return setTimeout(callback, ms);
    }
    clearTimeout(timer) {
        clearTimeout(timer);
    }
    setInterval(callback, ms) {
        return setInterval(callback, ms);
    }
    clearInterval(timer) {
        clearInterval(timer);
    }
    async getStateAsync(id) {
        return this.stateStore.get(id) ?? null;
    }
    async setState(id, state) {
        this.stateStore.set(id, state);
    }
    async setStateChanged(id, state) {
        this.stateStore.set(id, state);
    }
    async ensureState() { }
    async ensureFolder() { }
    async extendObject() { }
    async getObjectAsync() { return null; }
    async getStatesAsync() { return {}; }
    async getForeignStatesAsync() { return {}; }
    async setObjectNotExistsAsync() { }
    async subscribeStatesAsync() { }
    async unsubscribeStatesAsync() { }
    errorMessage(error) {
        return error instanceof Error ? error.message : String(error);
    }
    errorStack(error) {
        return error instanceof Error ? error.stack ?? error.message : String(error);
    }
    async catchError(error, attribute, duid) {
        this.rLog("System", duid, "Error", undefined, undefined, `${attribute || "task"}: ${this.errorStack(error)}`, "error");
    }
    formatRoborockDate(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    }
    async close() {
        this.requestsHandler.clearQueue();
        this.mqtt_api.cleanup();
        this.local_api.stopUdpDiscovery();
        this.local_api.stopTcpKeepaliveInterval();
        this.readyPromise = null;
        this.emit("disconnected");
    }
}
exports.RoborockNodeClient = RoborockNodeClient;
//# sourceMappingURL=RoborockNodeClient.js.map