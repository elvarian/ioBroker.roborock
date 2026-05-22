"use strict";
// src/main.ts
/// <reference types="@iobroker/adapter-core" />
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Roborock = void 0;
const utils = __importStar(require("@iobroker/adapter-core"));
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const go2rtc_static_1 = __importDefault(require("go2rtc-static"));
const commitInfo_1 = require("./lib/commitInfo");
// --- API & Helper Imports ---
const AppPluginManager_1 = require("./lib/AppPluginManager");
const b01Variant_1 = require("./lib/b01Variant");
const deviceManager_1 = require("./lib/deviceManager");
const features_enum_1 = require("./lib/features/features.enum");
const httpApi_1 = require("./lib/httpApi");
const localApi_1 = require("./lib/localApi");
const MapManager_1 = require("./lib/map/MapManager");
const mqttApi_1 = require("./lib/mqttApi");
const requestsHandler_1 = require("./lib/requestsHandler");
const socketHandler_1 = require("./lib/socketHandler");
const translationManager_1 = require("./lib/translationManager");
class Roborock extends utils.Adapter {
    // --- Public APIs (accessible by helpers) ---
    http_api;
    local_api;
    mqtt_api;
    requestsHandler;
    socketHandler;
    deviceManager;
    mapManager;
    translationManager;
    // --- Internal Properties ---
    deviceFeatureHandlers;
    nonce;
    pendingRequests;
    /** B01: FIFO queue of expected 301 map response types (classify + taskBeginDate match using this order). */
    b01MapResponseQueue = new Map();
    appPluginManager;
    isInitializing;
    sentryInstance;
    translations = {};
    commandTimeouts = new Map();
    mqttReconnectInterval = undefined;
    instance = 0;
    go2rtcProcess = null;
    // Bound exit handler to prevent memory leaks while allowing process.removeListener
    onExitBound = null;
    constructor(options = {}) {
        super({ ...options, name: "roborock", useFormatDate: true });
        this.instance = options.instance || 0;
        this.nonce = (0, node_crypto_1.randomBytes)(16);
        this.pendingRequests = new Map();
        this.http_api = new httpApi_1.http_api(this);
        this.local_api = new localApi_1.local_api(this);
        this.mqtt_api = new mqttApi_1.mqtt_api(this);
        this.requestsHandler = new requestsHandler_1.requestsHandler(this);
        this.mapManager = new MapManager_1.MapManager(this);
        this.translationManager = new translationManager_1.TranslationManager(this);
        this.deviceManager = new deviceManager_1.DeviceManager(this);
        this.socketHandler = new socketHandler_1.socketHandler(this);
        this.deviceFeatureHandlers = this.deviceManager.deviceFeatureHandlers;
        this.appPluginManager = new AppPluginManager_1.AppPluginManager(this);
        this.isInitializing = true;
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        // Global Error Handlers
        process.on("uncaughtException", (err) => {
            this.rLog("System", null, "Error", undefined, undefined, `Uncaught Exception: ${err.message}\n${err.stack}`, "error");
        });
        process.on("unhandledRejection", (reason) => {
            this.rLog("System", null, "Error", undefined, undefined, `Unhandled Rejection: ${reason}`, "error");
        });
    }
    /**
     * Adapter ready logic.
     */
    async onReady() {
        // Config properties are now type-safe thanks to types.d.ts
        if (!this.config.username) {
            this.rLog("System", null, "Error", undefined, undefined, "Username missing!", "error");
            this.isInitializing = false;
            return;
        }
        this.translationManager.init();
        this.sentryInstance = this.getPluginInstance("sentry");
        this.translations = require(`../admin/i18n/${this.language || "en"}/translations.json`);
        this.rLog("System", null, "Info", undefined, undefined, `Build Info: Date=${commitInfo_1.commitInfo.commitDate}, Commit=${commitInfo_1.commitInfo.commitHash}`, "debug");
        // Log adapter settings at start (no credentials) for easier support/debugging
        const safeSettings = {
            enable_map_creation: this.config.enable_map_creation,
            updateInterval: this.config.updateInterval,
            region: this.config.region,
            loginMethod: this.config.loginMethod,
            map_theme: this.config.map_theme,
        };
        if ("map_creation_interval" in this.config)
            safeSettings.map_creation_interval = this.config.map_creation_interval;
        if ("map_scale" in this.config)
            safeSettings.map_scale = this.config.map_scale;
        if ("webserverPort" in this.config)
            safeSettings.webserverPort = this.config.webserverPort;
        this.rLog("System", null, "Info", undefined, undefined, `Settings: ${JSON.stringify(safeSettings)}`, "info");
        // Full config for debug (credentials redacted)
        const configSummary = {
            ...this.config,
            username: this.config.username ? "******" : "NOT_SET",
            password: this.config.password ? "******" : "NOT_SET",
            cameraPin: this.config.cameraPin ? "******" : undefined,
        };
        this.rLog("System", null, "Info", undefined, undefined, `Config: ${JSON.stringify(configSummary)}`, "debug");
        await this.setupBasicObjects();
        try {
            const clientID = await this.ensureClientID();
            await this.http_api.init(clientID);
            // 1. Start Cloud Data Sync (Get Keys & DUIDs)
            await this.http_api.updateHomeData();
            // 1b. Asset download for account models (before device init)
            await this.downloadAssetsForAccountModels();
            // 2a. Start UDP Discovery (Essential for determining Local/Cloud mode before Init)
            await this.local_api.startUdpDiscovery();
            // 2b. Start MQTT and WAIT for the connection to be established
            await this.mqtt_api.init();
            // --- Pre-Init Network Probe (Docker/VLAN Support) ---
            this.rLog("System", null, "Info", undefined, undefined, "Starting Pre-Init Network Probe...", "debug");
            const allDevices = this.http_api.getDevices() || [];
            const probePromises = allDevices.map(async (device) => {
                const duid = device.duid;
                if (!device.online)
                    return; // Skip devices cloud reports as offline
                // If already local (UDP found it), skip
                if (this.local_api.isConnected(duid))
                    return;
                const protocolVersion = device.pv || await this.getDeviceProtocolVersion(duid);
                if (protocolVersion === "B01") {
                    const model = this.http_api.getRobotModel(duid) || "";
                    if (model && (0, b01Variant_1.getB01VariantFromModel)(model) === "Q10") {
                        return;
                    }
                }
                try {
                    // 1. Get Network Info (via MQTT as we have no TCP yet)
                    const result = await this.requestsHandler.sendRequest(duid, "get_network_info", []);
                    // 2. Extract IP
                    let networkData;
                    if (Array.isArray(result)) {
                        networkData = result[0];
                    }
                    else if (result && typeof result === "object") {
                        networkData = result;
                    }
                    if (networkData && typeof networkData.ip === "string") {
                        // 3. Attempt TCP Connect with short timeout (1.5s) and silent logging
                        await this.local_api.checkAndPromoteLocalConnection(duid, networkData.ip, 1500, true);
                    }
                }
                catch (e) {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    this.rLog("System", duid, "Debug", undefined, undefined, `Probe failed: ${errorMsg}`, "debug");
                }
            });
            // Wait for all probes to finish (with timeout to not block forever)
            await Promise.race([
                Promise.all(probePromises),
                new Promise(resolve => setTimeout(resolve, 2000)) // Max 2s probe time
            ]);
            this.rLog("System", null, "Info", undefined, undefined, "Network Probe finished.", "info");
            // ----------------------------------------------------
            // 3. Initialize Devices (now that communication channels are ready)
            await this.deviceManager.initializeDevices();
            const writableFolders = new Set();
            for (const handler of this.deviceFeatureHandlers.values()) {
                for (const folder of handler.getCommandFolders()) {
                    writableFolders.add(folder);
                }
            }
            // Parallelize non-dependent startup tasks
            await Promise.all([
                this.processScenes(),
                this.start_go2rtc(),
                ...Array.from(writableFolders).map((folder) => this.subscribeStatesAsync(`Devices.*.${folder}.*`)),
                this.subscribeStatesAsync("Devices.*.resetConsumables.*"),
                this.subscribeStatesAsync("Devices.*.programs.*"),
                this.subscribeStatesAsync("Devices.*.deviceStatus.state"),
                this.subscribeStatesAsync("Devices.*.deviceStatus.status"),
                this.subscribeStatesAsync("loginCode")
            ]);
            this.deviceManager.startPolling();
            this.local_api.startTcpKeepaliveInterval();
            this.rLog("System", null, "Info", undefined, undefined, "Adapter startup finished. Let's go!", "info");
            this.isInitializing = false;
            // Schedule MQTT API reset every hour (legacy behavior to prevent stale connections)
            this.mqttReconnectInterval = this.setInterval(() => {
                this.rLog("System", null, "Debug", undefined, undefined, "Running scheduled MQTT reconnect...", "debug");
                this.resetMqttApi().catch((e) => {
                    this.rLog("System", null, "Error", undefined, undefined, `Scheduled MQTT reconnect failed: ${e instanceof Error ? e.message : String(e)}`, "error");
                    this.catchError(e, "resetMqttApi (scheduled)");
                });
            }, 3600 * 1000);
        }
        catch (e) {
            this.rLog("System", null, "Error", undefined, undefined, `Failed to initialize adapter: ${this.errorMessage(e)}`, "error");
            this.catchError(e, "onReady");
            this.isInitializing = false;
        }
    }
    /**
     * Message handler for Admin/Vis communication.
     */
    async onMessage(obj) {
        if (obj && obj.command && obj.callback) {
            try {
                // Forward to the dedicated handler
                await this.socketHandler.handleMessage(obj);
            }
            catch (err) {
                this.rLog("Requests", null, "Error", undefined, undefined, `Failed to execute command ${obj.command}: ${this.errorMessage(err)}`, "error");
                this.sendTo(obj.from, obj.command, { error: this.errorMessage(err) }, obj.callback);
            }
        }
    }
    /**
     * Executes a scene locally by parsing the scene definition and sending commands to the device.
     */
    async executeSceneLocal(sceneId) {
        try {
            this.rLog("Requests", null, "Info", undefined, undefined, `[Scene] Executing local scene ${sceneId}`, "info");
            // 1. Fetch scenes
            const scenes = await this.http_api.getScenes();
            if (!scenes || !scenes.result) {
                this.rLog("Requests", null, "Error", undefined, undefined, `[Scene] Failed to fetch scenes or no result for ${sceneId}`, "error");
                return;
            }
            // 2. Find target scene
            // Scene ID from state might be string, API returns number. Compare loosely or convert.
            const scene = scenes.result.find((s) => s.id == sceneId);
            if (!scene) {
                this.rLog("Requests", null, "Error", undefined, undefined, `[Scene] Scene ${sceneId} not found`, "error");
                return;
            }
            this.rLog("Requests", null, "Debug", undefined, undefined, `[Scene] Found scene "${scene.name}"`, "debug");
            // 3. Parse 'param' field
            let params;
            try {
                params = JSON.parse(scene.param);
            }
            catch (e) {
                this.rLog("Requests", null, "Error", undefined, undefined, `[Scene] Failed to parse params for ${sceneId}: ${this.errorMessage(e)}`, "error");
                return;
            }
            // 4. Iterate actions and execute
            if (params.action && params.action.items) {
                for (const item of params.action.items) {
                    if (item.type === "CMD") {
                        const targetDuid = item.entityId;
                        let commandPayload;
                        try {
                            commandPayload = JSON.parse(item.param);
                        }
                        catch (e) {
                            this.rLog("Requests", targetDuid, "Error", undefined, undefined, `[Scene] Failed to parse command params for item ${item.id}: ${this.errorMessage(e)}`, "error");
                            continue;
                        }
                        const method = commandPayload.method;
                        const args = commandPayload.params;
                        this.rLog("Requests", targetDuid, "Info", undefined, undefined, `[Scene] Executing "${scene.name}": sending "${method}"`, "info");
                        // 5. Send command via requestsHandler
                        // We pass 'null' as handler because we are sending a raw command directly via specific method/args
                        // and don't need the abstraction of 'BaseDeviceFeatures' here if we go direct.
                        // However, requestsHandler.command expects a handler.
                        // Let's resolve the handler for the target Duid if possible, or cast/hack if needed.
                        const handler = this.deviceFeatureHandlers.get(targetDuid);
                        if (handler) {
                            await this.requestsHandler.command(handler, targetDuid, method, args);
                        }
                        else {
                            this.rLog("Requests", targetDuid, "Warn", undefined, undefined, `[Scene] No handler found. Falling back to raw send for "${method}"`, "warn");
                            // Fallback: sendRequest only. Status refresh after activity-start is still triggered in resolvePendingRequest when response arrives.
                            await this.requestsHandler.sendRequest(targetDuid, method, args);
                        }
                    }
                }
            }
            else {
                this.rLog("Requests", null, "Warn", undefined, undefined, `[Scene] Scene ${sceneId} has no actions`, "warn");
            }
        }
        catch (e) {
            this.rLog("Requests", null, "Error", undefined, undefined, `[Scene] Error executing ${sceneId}: ${this.errorMessage(e)}`, "error");
        }
    }
    /** Legacy request-based keepalive. TCP socket sessions now use localApi PINGREQ frames. */
    sendTcpKeepalive(duid) {
        this.requestsHandler.sendRequest(duid, "get_prop", ["get_status"], { priority: requestsHandler_1.RequestPriority.LOW }).catch(() => { });
    }
    /**
     * Is called when adapter shuts down.
     */
    onUnload(callback) {
        try {
            if (this.mqttReconnectInterval) {
                this.clearInterval(this.mqttReconnectInterval);
            }
            this.clearTimersAndIntervals();
            this.mqtt_api.cleanup();
            this.local_api.stopUdpDiscovery();
            this.local_api.stopTcpKeepaliveInterval();
            // Remove the global process exit listener to prevent memory leaks
            if (this.onExitBound) {
                process.removeListener("exit", this.onExitBound);
                this.onExitBound = null;
            }
            if (this.go2rtcProcess) {
                this.rLog("Local", null, "Info", undefined, undefined, "Stopping go2rtc process...", "info");
                this.go2rtcProcess.kill();
                this.go2rtcProcess = null;
            }
            this.setState("info.connection", { val: false, ack: true });
            callback();
        }
        catch (e) {
            this.rLog("System", null, "Error", undefined, undefined, `Failed to unload adapter: ${this.errorStack(e)}`, "error");
            callback();
        }
    }
    /**
     * Is called if a subscribed state changes.
     */
    async onStateChange(id, state) {
        if (!state)
            return;
        const idParts = id.split(".");
        // deviceStatus.state (V1) or deviceStatus.status (B01): react only to our own updates (ack) — active -> idle triggers cleaning records update
        if (state.ack && idParts[2] === "Devices" && idParts.length >= 6 && idParts[4] === "deviceStatus" && (idParts[5] === "state" || idParts[5] === "status")) {
            const duid = idParts[3];
            const newVal = state.val != null ? Number(state.val) : 0;
            if (!isNaN(newVal)) {
                this.deviceManager.onDeviceStateChange(duid, newVal).catch((e) => this.catchError(e, "onStateChange(deviceStatus)", duid));
            }
            return;
        }
        if (state.ack) {
            if (id.endsWith(".online") && idParts.length >= 4) {
                this.rLog("System", idParts[3], "Info", undefined, undefined, `Device is now ${state.val ? "online" : "offline"}`, "info");
            }
            return;
        }
        // Check for root loginCode (roborock.0.loginCode)
        if (idParts[2] === "loginCode" && state.val && String(state.val).length === 6) {
            this.http_api.submitLoginCode(String(state.val));
            return;
        }
        // Devices logic
        if (idParts[2] !== "Devices")
            return;
        if (idParts.length < 6)
            return;
        const duid = idParts[3];
        const folder = idParts[4];
        const command = idParts[5];
        // Special handling for floors (deeply nested: Devices.duid.floors.mapFlag.load)
        if (folder === "floors" && idParts.length >= 7) {
            const mapFlag = parseInt(idParts[5], 10);
            const target = idParts[6];
            // Load Map Button
            if (target === "load" && (state.val === true || state.val === "true" || state.val === 1)) {
                await this.handleFloorSwitch(duid, mapFlag, id);
                return;
            }
        }
        this.rLog("Requests", duid, "Info", undefined, undefined, `[onStateChange] Processing ${folder}.${command}`, "info");
        const handler = this.deviceFeatureHandlers.get(duid);
        if (!handler) {
            this.rLog("Requests", duid, "Warn", undefined, undefined, "[onStateChange] Received command for unknown device", "warn");
            return;
        }
        try {
            await this.handleCommand(duid, folder, command, state, handler, id);
        }
        catch (e) {
            this.catchError(e, `onStateChange (${command})`, duid);
        }
    }
    /**
     * Handles commands from onStateChange.
     */
    async handleCommand(duid, folder, command, state, handler, id) {
        if (folder === "resetConsumables" && state.val === true) {
            await this.requestsHandler.command(handler, duid, "reset_consumable", command, id);
            // Reset button
            this.setResetTimeout(id);
        }
        else if (folder === "programs" && command === "startProgram") {
            await this.executeSceneLocal(state.val);
            this.setResetTimeout(id); // Use setResetTimeout to reset to null/empty after 1s?
            // Actually executeSceneLocal takes time.
            // Better: explicit reset.
            await this.setState(id, { val: null, ack: true });
        }
        else if (handler.hasCommandFolder(folder)) {
            const cmdDef = handler.getCommandSpec(folder, command);
            if (!cmdDef) {
                this.rLog("Requests", duid, "Warn", handler.protocolVersion || undefined, undefined, `[handleCommand] Ignoring unregistered command ${folder}.${command}`, "warn");
                return;
            }
            this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[handleCommand] Entering commands block for ${command}`, "info");
            try {
                await this.executeCommand(handler, duid, command, state, cmdDef);
            }
            finally {
                // Reset boolean command state ONLY if it is defined as boolean
                const isBoolean = cmdDef.type === "boolean";
                if (isBoolean && this.isTruthy(state.val)) {
                    this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[handleCommand] Scheduling reset for ${id} (boolean)`, "info");
                    this.setResetTimeout(id);
                }
            }
        }
    }
    /**
     * Executes a specific command for a device.
     */
    async executeCommand(handler, duid, command, state, cmdDef) {
        const val = state.val;
        // 1. Common command types handling
        const isButton = cmdDef.role === "button" || cmdDef.type === "boolean";
        if (isButton) {
            if (this.isTruthy(val)) {
                this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[executeCommand] Triggering button command ${command}`, "info");
                await this.requestsHandler.command(handler, duid, command);
            }
            else {
                this.rLog("Requests", duid, "Debug", handler.protocolVersion || undefined, undefined, `[executeCommand] Ignoring button command ${command} (val=${val})`, "debug");
            }
            return;
        }
        // Log start of command execution for diagnostics
        this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[executeCommand] Starting ${command} with params ${typeof val === "object" ? JSON.stringify(val) : val}`, "info");
        // 2. Generic data commands (Numbers, Strings, JSON strings)
        // We pass the raw value. getCommandParams in feature handlers will do the packaging (e.g. [val]).
        if (typeof val === "string") {
            const parsed = this.tryParseJson(val);
            await this.requestsHandler.command(handler, duid, command, parsed !== undefined ? parsed : val);
        }
        else {
            await this.requestsHandler.command(handler, duid, command, val);
        }
    }
    isTruthy(val) {
        return val === true || val === "true" || val === 1 || val === "1";
    }
    /**
     * Sets a timeout to reset a state to false after 1 second.
     * Helps avoid race conditions by managing timeouts in a map.
     */
    setResetTimeout(id) {
        const timeoutKey = `${id}_reset`;
        if (this.commandTimeouts.has(timeoutKey)) {
            this.clearTimeout(this.commandTimeouts.get(timeoutKey));
        }
        const timeout = this.setTimeout(() => {
            this.rLog("Requests", null, "Debug", undefined, undefined, `[setResetTimeout] Resetting ${id} to false`, "debug");
            this.setState(id, false, true);
            this.commandTimeouts.delete(timeoutKey);
        }, 1000);
        if (timeout)
            this.commandTimeouts.set(timeoutKey, timeout);
    }
    /**
     * Ensures a ClientID exists.
     */
    async ensureClientID() {
        try {
            const clientIDState = await this.getStateAsync("clientID"); // Revert to Async
            if (clientIDState?.val) {
                this.rLog("System", null, "Info", undefined, undefined, `Loaded existing clientID: ${clientIDState.val}`, "info");
                return clientIDState.val.toString();
            }
            const randomClientID = (0, node_crypto_1.randomBytes)(16).toString("hex");
            await this.setState("clientID", { val: randomClientID, ack: true });
            this.rLog("System", null, "Info", undefined, undefined, `Generated and saved new clientID: ${randomClientID}`, "info");
            return randomClientID;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.rLog("System", null, "Error", undefined, undefined, `Error ensuring clientID: ${errorMsg}`, "error");
            throw error;
        }
    }
    /**
     * Creates base adapter objects (Folders, States).
     */
    async setupBasicObjects() {
        await this.setObjectNotExistsAsync("Devices", { type: "folder", common: { name: "Devices" }, native: {} });
        await this.ensureState("UserData", { name: "UserData string", write: false });
        await this.ensureState("HomeData", { name: "HomeData string", write: false });
        await this.ensureState("clientID", { name: "Client ID", write: false });
        await this.ensureState("endpoint", { name: "MQTT endpoint", write: false });
    }
    /** Obstacle assets for account models at startup (before device init). */
    async downloadAssetsForAccountModels() {
        try {
            await this.http_api.ensureProductInfo();
            let devices = this.http_api.getDevices() || [];
            for (let wait = 0; wait < 6 && devices.length === 0; wait++) {
                await new Promise((r) => setTimeout(r, 500));
                devices = this.http_api.getDevices() || [];
            }
            const modelsInAccount = new Set();
            for (const d of devices) {
                const m = this.http_api.getRobotModel(d.duid);
                if (m && m !== "unknown" && m.includes("."))
                    modelsInAccount.add(m);
            }
            if (modelsInAccount.size === 0)
                return;
            this.rLog("System", null, "Info", undefined, undefined, `Downloading obstacle assets for ${modelsInAccount.size} model(s)...`, "info");
            await this.http_api.downloadProductImages();
            for (const model of modelsInAccount) {
                await this.appPluginManager.downloadAssetsForModelIfMissing(model).catch((e) => {
                    this.rLog("Cloud", null, "Debug", undefined, undefined, `Asset download for ${model}: ${e instanceof Error ? e.message : String(e)}`, "debug");
                });
            }
        }
        catch (e) {
            this.rLog("System", null, "Warn", undefined, undefined, `Obstacle asset download failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
        }
    }
    /**
     * Processes scenes from HTTP API.
     */
    async processScenes() {
        const scenes = await this.http_api.getScenes();
        if (!scenes?.result)
            return;
        const data = scenes.result;
        const programs = {};
        for (const program of data) {
            try {
                const { enabled, id, name, param } = program;
                const params = JSON.parse(param);
                const duid = params.action.items[0].entityId;
                if (!programs[duid])
                    programs[duid] = {};
                programs[duid][id] = name;
                await this.ensureFolder(`Devices.${duid}.programs`);
                await this.setObjectNotExistsAsync(`Devices.${duid}.programs.${id}`, {
                    type: "folder",
                    common: { name },
                    native: {},
                });
                await this.ensureState(`Devices.${duid}.programs.${id}.enabled`, { name: "Enabled", type: "boolean" });
                this.setState(`Devices.${duid}.programs.${id}.enabled`, enabled, true);
            }
            catch (e) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                this.rLog("Requests", null, "Warn", undefined, undefined, `[processScenes] Failed to process scene "${program.name}" (${program.id}): ${errorMsg}`, "warn");
            }
        }
        for (const duid in programs) {
            await this.ensureState(`Devices.${duid}.programs.startProgram`, {
                name: "Start saved program",
                type: "string",
                write: true,
                states: programs[duid],
            });
        }
    }
    /**
     * Clears all timeouts and intervals.
     */
    clearTimersAndIntervals() {
        this.commandTimeouts.forEach((timeout) => this.clearTimeout(timeout));
        this.commandTimeouts.clear();
        this.deviceManager.stopPolling();
        this.requestsHandler.clearQueue();
    }
    /** Timestamp keys we format as readable date string; all other keys passed through as-is. */
    static DEVICE_INFO_DATE_KEYS = ["activeTime", "active_time", "createTime", "create_time"];
    static DEVICE_INFO_NAME_OVERRIDES = {
        activeTime: "Last Activity",
        active_time: "Last Activity",
        createTime: "Created At",
        create_time: "Created At"
    };
    /**
     * Updates deviceInfo from cloud HomeData: all top-level device fields are written to
     * Devices.${duid}.deviceInfo.* (names unchanged). Scalars as-is; objects/arrays as JSON string.
     */
    async updateDeviceInfo(duid, devices) {
        const device = devices.find((d) => d.duid === duid);
        if (!device)
            return;
        const raw = device;
        for (const attr of Object.keys(raw)) {
            let value = raw[attr];
            if (typeof value === "object" && value !== null) {
                value = JSON.stringify(value);
            }
            const common = {};
            let finalValue = value;
            if (Roborock.DEVICE_INFO_NAME_OVERRIDES[attr]) {
                common.name = Roborock.DEVICE_INFO_NAME_OVERRIDES[attr];
            }
            if (Roborock.DEVICE_INFO_DATE_KEYS.includes(attr) && typeof value === "number") {
                finalValue = this.formatRoborockDate(value);
                common.type = "string";
            }
            else {
                common.type = typeof finalValue;
            }
            await this.ensureState(`Devices.${duid}.deviceInfo.${attr}`, common);
            await this.setStateChanged(`Devices.${duid}.deviceInfo.${attr}`, { val: finalValue, ack: true });
        }
    }
    /**
     * Checks for new firmware.
     */
    async checkForNewFirmware(duid) {
        const isLocal = this.local_api.isLocalDevice(duid);
        if (!isLocal)
            return;
        try {
            this.rLog("HTTP", duid, "Debug", undefined, undefined, "[checkForNewFirmware] Checking for firmware update...", "debug");
            const update = await this.http_api.getFirmwareStates(duid);
            this.rLog("HTTP", duid, "Debug", undefined, undefined, `[checkForNewFirmware] Result: ${JSON.stringify(update)}`, "debug");
            if (update.data.result) {
                for (const state in update.data.result) {
                    const value = update.data.result[state];
                    await this.ensureState(`Devices.${duid}.updateStatus.${state}`, { type: typeof value });
                    await this.setStateChanged(`Devices.${duid}.updateStatus.${state}`, { val: value, ack: true });
                }
            }
            else {
                this.rLog("HTTP", duid, "Warn", undefined, undefined, "[checkForNewFirmware] No result in firmware update response", "warn");
            }
        }
        catch (error) {
            this.rLog("HTTP", duid, "Warn", undefined, undefined, `Failed to check for new firmware: ${this.errorMessage(error)}`, "warn");
        }
    }
    /**
     * Creates a state if it doesn't exist, applying translations.
     */
    async ensureState(path, commonOptions, native = {}) {
        const stateName = path.split(".").pop() || path;
        // Allow empty string as name if explicitly provided. Only use fallback if name is undefined.
        const translatedName = commonOptions.name !== undefined ? commonOptions.name : (this.translations[stateName] || stateName);
        const baseCommon = {
            name: translatedName,
            type: "string",
            role: "value",
            read: true,
            write: false,
        };
        const finalCommon = { ...baseCommon, ...commonOptions, name: translatedName };
        if (finalCommon.def === undefined || finalCommon.def === null || finalCommon.def === "") {
            delete finalCommon.def;
        }
        let oldObj;
        try {
            oldObj = await this.getObjectAsync(path);
        }
        catch {
            oldObj = null; // Does not exist
        }
        // Check if object exists AND if its metadata is different from what we need
        if (oldObj && !this.hasCommonChanged(oldObj.common, finalCommon)) {
            return;
        }
        try {
            if (oldObj) {
                // Object exists, but metadata changed
                // Safely merge common properties
                const newCommon = { ...oldObj.common, ...finalCommon };
                // Force extension to apply changes
                await this.extendObject(path, { common: newCommon });
            }
            else {
                // Object does not exist, create it new.
                // Provide mandatory defaults for a valid ioBroker state object.
                const defaults = {
                    role: "state",
                    read: true,
                    write: false,
                    type: "mixed"
                };
                const commonObj = { ...defaults, ...finalCommon };
                if (!commonObj.type)
                    commonObj.type = "mixed";
                await this.setObject(path, {
                    type: "state",
                    common: commonObj,
                    native: native,
                });
            }
        }
        catch (e) {
            this.rLog("System", null, "Error", undefined, undefined, `[ensureState] Failed to update/create object for "${path}": ${this.errorMessage(e)}`, "error");
        }
    }
    /**
     * Helper to check if common properties of an object have meaningfully changed.
     *
     * PERFORMANCE CRITICAL:
     * This method prevents "Write Storms" to the ioBroker database (objects.json/redis).
     * Writing objects is expensive (disk I/O) and triggers system-wide events.
     * We only write if the definition (name, role, unit, etc.) has actually changed.
     * This significantly reduces CPU usage and disk wear on startup.
     */
    hasCommonChanged(oldCommon, newCommon) {
        if (newCommon.type !== undefined && oldCommon.type !== newCommon.type)
            return true;
        if (newCommon.name !== undefined && this.stringifySorted(oldCommon.name) !== this.stringifySorted(newCommon.name))
            return true;
        if (newCommon.states !== undefined && this.stringifySorted(oldCommon.states) !== this.stringifySorted(newCommon.states))
            return true;
        if (newCommon.role !== undefined && oldCommon.role !== newCommon.role)
            return true;
        if (newCommon.unit !== undefined && oldCommon.unit !== newCommon.unit)
            return true;
        if (newCommon.min !== undefined && oldCommon.min !== newCommon.min)
            return true;
        if (newCommon.max !== undefined && oldCommon.max !== newCommon.max)
            return true;
        if (newCommon.icon !== undefined && oldCommon.icon !== newCommon.icon)
            return true;
        if (newCommon.read !== undefined && oldCommon.read !== newCommon.read)
            return true;
        if (newCommon.write !== undefined && oldCommon.write !== newCommon.write)
            return true;
        if (newCommon.def !== undefined && oldCommon.def !== newCommon.def)
            return true;
        return false;
    }
    /**
     * JSON.stringify with sorted keys for consistent object comparison.
     */
    stringifySorted(obj) {
        return JSON.stringify(obj, (_key, value) => {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                return Object.keys(value)
                    .sort()
                    .reduce((sorted, key) => {
                    sorted[key] = value[key];
                    return sorted;
                }, {});
            }
            return value;
        });
    }
    /**
     * Safe string from any thrown value (message if Error, else String(e)).
     * Use in catch (e: unknown) instead of repeating e instanceof Error ? e.message : String(e).
     */
    errorMessage(e) {
        return e instanceof Error ? e.message : String(e);
    }
    /**
     * Stack trace if Error, else message, else String(e).
     */
    errorStack(e) {
        if (e instanceof Error)
            return e.stack ?? e.message;
        return String(e);
    }
    /**
     * Helper to format Roborock timestamps (seconds) to locale string.
     */
    formatRoborockDate(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    }
    /**
     * Helper to safely parse JSON strings that look like objects/arrays.
     */
    tryParseJson(value) {
        const trimmed = value.trim();
        if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && (trimmed.endsWith("}") || trimmed.endsWith("]"))) {
            try {
                return JSON.parse(trimmed);
            }
            catch {
                return undefined;
            }
        }
        return undefined;
    }
    /**
     * Creates a folder if it doesn't exist, applying translations.
     */
    async ensureFolder(path, customName) {
        const attribute = path.split(".").pop() || path;
        const name = customName || this.translations[attribute] || attribute;
        let oldObj;
        try {
            oldObj = await this.getObjectAsync(path);
        }
        catch {
            oldObj = null; // Does not exist
        }
        if (!oldObj || oldObj.type !== "folder") {
            await this.setObject(path, {
                type: "folder",
                common: {
                    name: name
                },
                native: {}
            });
        }
        else if (customName !== undefined) {
            // Only update name when explicitly passed; avoid overwriting with path segment when ensuring existence (issue #1140)
            const currentName = oldObj.common.name;
            const isDifferent = JSON.stringify(currentName) !== JSON.stringify(name);
            if (isDifferent) {
                try {
                    await this.extendObject(path, { common: { name } });
                }
                catch (e) {
                    this.rLog("System", null, "Error", undefined, undefined, `Failed to update folder name for ${path}: ${this.errorMessage(e)}`, "error");
                }
            }
        }
    }
    /**
     * Gets the protocol version for a device.
     */
    async getDeviceProtocolVersion(duid) {
        const tcpConnected = this.local_api.isConnected(duid);
        if (tcpConnected) {
            const localPv = this.local_api.getLocalProtocolVersion(duid);
            if (localPv)
                return localPv;
        }
        const devices = this.http_api.getDevices();
        const device = devices ? devices.find((d) => d.duid == duid) : undefined;
        return device?.pv || "1.0";
    }
    /**
     * Returns the B01 sub-variant for a device when applicable.
     * Q10 behaves event-driven and is routed separately from classic B01/Q7.
     */
    async getB01Variant(duid) {
        const handler = this.deviceFeatureHandlers.get(duid);
        if (handler && "b01Variant" in handler && typeof handler.b01Variant === "string") {
            return handler.b01Variant;
        }
        const pv = await this.getDeviceProtocolVersion(duid);
        if (pv !== "B01")
            return null;
        const model = this.http_api.getRobotModel(duid);
        return model ? (0, b01Variant_1.getB01VariantFromModel)(model) : "Q7";
    }
    /**
     * Starts the go2rtc process if cameras are present.
     */
    async start_go2rtc() {
        const devices = this.http_api.getDevices() || [];
        const localKeys = this.http_api.getMatchedLocalKeys();
        const { u, s, k } = this.http_api.get_rriot();
        const apiPort = 1984 + this.instance; // API/Web Port
        const rtspPort = 8554 + this.instance; // RTSP Port
        const go2rtcConfig = {
            server: { listen: `:${apiPort}` },
            rtsp: { listen: `:${rtspPort}` },
            streams: {},
        };
        let cameraCount = 0;
        for (const device of devices) {
            const duid = device.duid;
            const handler = this.deviceFeatureHandlers.get(duid);
            const localKey = localKeys.get(duid);
            if (handler && localKey && handler.hasStaticFeature(features_enum_1.Feature.Camera)) {
                cameraCount++;
                go2rtcConfig.streams[duid] = `roborock://mqtt-eu-3.roborock.com:8883?u=${u}&s=${s}&k=${k}&did=${duid}&key=${localKey}&pin=${this.config.cameraPin}`;
            }
        }
        if (cameraCount > 0 && go2rtc_static_1.default) {
            try {
                this.go2rtcProcess = (0, node_child_process_1.spawn)(go2rtc_static_1.default.toString(), ["-config", JSON.stringify(go2rtcConfig)], { shell: false, detached: false, windowsHide: true });
                this.go2rtcProcess.on("error", (err) => this.rLog("Local", null, "Error", undefined, undefined, `go2rtc start error: ${err.message}`, "error"));
                this.go2rtcProcess.stdout.on("data", (data) => this.rLog("Local", null, "Debug", undefined, undefined, `go2rtc output: ${data.toString().trim()}`, "debug"));
                this.go2rtcProcess.stderr.on("data", (data) => {
                    const msg = data.toString().trim();
                    const isShutdown = /signal:\s*terminated|exit with signal/i.test(msg);
                    this.rLog("Local", null, isShutdown ? "Info" : "Error", undefined, undefined, `go2rtc ${isShutdown ? "output" : "error output"}: ${msg}`, isShutdown ? "info" : "error");
                });
                // Remove the process reference on exit to prevent double-kill attempts
                this.go2rtcProcess.on("exit", () => {
                    this.go2rtcProcess = null;
                });
                // Safety net: Ensure child process ensures if Node.js crashes/exits
                this.onExitBound = () => {
                    if (this.go2rtcProcess) {
                        this.go2rtcProcess.kill();
                    }
                };
                process.on("exit", this.onExitBound);
            }
            catch (error) {
                this.rLog("Local", null, "Error", undefined, undefined, `Failed to spawn go2rtc: ${this.errorMessage(error)}`, "error");
            }
        }
    }
    /**
     * Processes A01 (Tuya) protocol messages.
     */
    async processA01(duid, response) {
        if (!response?.dps) {
            this.rLog("Local", duid, "Warn", "A01", undefined, `Invalid response: ${JSON.stringify(response)}`, "warn");
            return;
        }
        const determineType = (value) => {
            const t = typeof value;
            if (t === "number")
                return "number";
            if (t === "boolean")
                return "boolean";
            if (t === "object" && value !== null)
                return "object";
            return "string";
        };
        // Recursive helper for nested JSON objects
        const processNested = async (basePath, obj) => {
            for (const [key, value] of Object.entries(obj)) {
                const path = `${basePath}.${key}`;
                if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                    await this.ensureFolder(path);
                    await processNested(path, value);
                }
                else {
                    const val = typeof value === "object" || value === null ? JSON.stringify(value) : value;
                    await this.ensureState(path, { name: key, type: determineType(value), write: false });
                    await this.setStateChanged(path, { val, ack: true });
                }
            }
        };
        for (const [id, value] of Object.entries(response.dps)) {
            // A01 states are not defined in main.ts anymore, this is just a fallback name
            const stateName = id;
            let parsedValue = value;
            let isJson = false;
            if (typeof value === "object" && value !== null) {
                parsedValue = value;
                isJson = true;
            }
            else if (typeof value === "string") {
                const maybeJson = this.tryParseJson(value);
                if (maybeJson !== undefined) {
                    parsedValue = maybeJson;
                    isJson = true;
                }
            }
            if (isJson && typeof parsedValue === "object" && parsedValue !== null) {
                const basePath = `Devices.${duid}.${id}`; // Use ID as folder name
                await this.ensureFolder(basePath);
                await processNested(basePath, parsedValue);
            }
            else {
                const path = `Devices.${duid}.deviceStatus.${id}`;
                await this.ensureState(path, { name: stateName, type: determineType(value), write: false });
                await this.setStateChanged(path, { val: parsedValue, ack: true });
            }
        }
    }
    /**
     * Resets the MQTT API instance.
     */
    async resetMqttApi() {
        this.rLog("System", null, "Info", undefined, undefined, "Resetting MQTT API instance...", "info");
        if (this.mqtt_api) {
            this.mqtt_api.cleanup();
            this.requestsHandler.clearQueue(); // Prevents pending promises
        }
        // Create a new MQTT API instance and initialize it
        this.mqtt_api = new mqttApi_1.mqtt_api(this);
        await this.mqtt_api.init();
        this.rLog("System", null, "Info", undefined, undefined, "MQTT API instance has been reset.", "info");
    }
    /**
     * Centralized error handler.
     */
    async catchError(error, attribute, duid) {
        const robotModel = duid ? this.http_api.getRobotModel(duid) : "unknown";
        const stack = this.errorStack(error);
        const errorMsg = this.errorMessage(error);
        const msg = `Failed processing ${attribute || "task"} on ${duid || "adapter"} (${robotModel}): ${stack}`;
        if (errorMsg.includes("retry") || errorMsg.includes("locating") || errorMsg.includes("timed out")) {
            this.rLog("System", duid, "Warn", undefined, undefined, msg, "warn");
        }
        else {
            this.rLog("System", duid, "Error", undefined, undefined, msg, "error");
            if (this.sentryInstance) {
                this.sentryInstance.getSentryObject().captureException(error);
            }
        }
    }
    /**
     * Centralized Logging Function for Protocol Messages
     * Format: [Connection] [duid] direction [version] [protocol] [ID: id] | payload
     */
    rLog(connection, duid, direction, version, protocol, message, level = "debug", msgId) {
        // Use == as a neutral placeholder for alignment if it's not actual traffic (<- or ->).
        const directionDisplay = (direction === "<-" || direction === "->") ? direction : "==";
        // Construct prefix and message body using parts to ensure clean spacing.
        const parts = [directionDisplay, `[${connection}]`];
        if (duid)
            parts.push(`[${duid}]`);
        if (version)
            parts.push(`[${version}]`);
        if (protocol)
            parts.push(`[${protocol}]`);
        if (msgId !== undefined)
            parts.push(`[ID: ${msgId}]`);
        const logMsg = `${parts.join(" ")} | ${message}`;
        switch (level) {
            case "debug":
                this.log.debug(logMsg);
                break;
            case "info":
                this.log.info(logMsg);
                break;
            case "warn":
                this.log.warn(logMsg);
                break;
            case "error":
                this.log.error(logMsg);
                break;
        }
    }
    // Helper to handle floor switching logic (extracted to reduce nesting)
    async handleFloorSwitch(duid, mapFlag, stateId) {
        const handler = this.deviceFeatureHandlers.get(duid);
        if (!handler)
            return;
        try {
            this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[floorSwitch] Loading map ${mapFlag}`, "info");
            // 1. Send load command and wait for robot ACK
            await this.requestsHandler.sendRequest(duid, "load_multi_map", [mapFlag], { timeout: 60000 });
            this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, "[floorSwitch] Load acknowledged, verifying map index sync", "info");
            // Failsafe: Robot says "ok" but might need a few seconds to switch currentMapIndex
            const startTime = Date.now();
            let verified = false;
            for (let i = 0; i < 10; i++) {
                await handler.updateStatus();
                const currentIndex = handler.getCurrentMapIndex();
                // Use exposed method if available or cast to any to access internal if needed (assuming logic added to V1Feature)
                // For now relying on public interface which delegates to V1MapService
                const rawStatus = handler.mapService ? handler.mapService.lastMapStatus : -1;
                const elapsed = Date.now() - startTime;
                // Verify using both index match and verifying raw status supports it
                if (currentIndex === mapFlag) {
                    this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[floorSwitch] Synced map index to ${currentIndex} (status=${rawStatus}, attempt=${i + 1}/10, elapsed=${elapsed}ms)`, "info");
                    verified = true;
                    break;
                }
                this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[floorSwitch] Waiting for sync (current=${currentIndex}, target=${mapFlag}, status=${rawStatus}, attempt=${i + 1}/10, elapsed=${elapsed}ms)`, "info");
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            if (!verified) {
                this.rLog("Requests", duid, "Warn", handler.protocolVersion || undefined, undefined, `[floorSwitch] Map index did not sync to ${mapFlag} after retries; proceeding`, "warn");
            }
            await handler.updateMultiMapsList();
            await handler.updateRoomMapping();
            await handler.updateMap();
            this.rLog("Requests", duid, "Info", handler.protocolVersion || undefined, undefined, `[floorSwitch] Completed switch to map ${mapFlag}`, "info");
        }
        catch (e) {
            this.catchError(e, "floorSwitch", duid);
        }
        finally {
            // Reset button
            this.setResetTimeout(stateId);
        }
    }
}
exports.Roborock = Roborock;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new Roborock(options);
}
else {
    // otherwise start the instance directly
    new Roborock();
}
//# sourceMappingURL=main.js.map