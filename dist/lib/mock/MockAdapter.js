"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockAdapter = void 0;
class MockAdapter {
    objects = {};
    states = {};
    log;
    config = {};
    requestsHandler;
    mqtt_api;
    local_api;
    http_api;
    // mock support methods
    instance = 0;
    namespace = "roborock.0";
    pendingRequests = new Map();
    nonce = Buffer.alloc(16);
    translations = {};
    logLevel = "warn";
    logLevels = { debug: 0, info: 1, warn: 2, error: 3 };
    catchError(error, attribute) {
        this.log.error(`[CatchError] ${attribute}: ${error}`);
    }
    /** Match real adapter: safe string from thrown value. */
    errorMessage(e) {
        return e instanceof Error ? e.message : String(e);
    }
    /** Match real adapter: stack if Error, else message, else String(e). */
    errorStack(e) {
        if (e instanceof Error)
            return e.stack ?? e.message;
        return String(e);
    }
    setInterval(callback, ms, ...args) {
        return setInterval(callback, ms, ...args);
    }
    setTimeout(callback, ms, ...args) {
        return setTimeout(callback, ms, ...args);
    }
    clearInterval(intervalId) {
        clearInterval(intervalId);
    }
    clearTimeout(timeoutId) {
        clearTimeout(timeoutId);
    }
    getDeviceProtocolVersion = async () => {
        return "1.0";
    };
    getB01Variant = async () => {
        return null;
    };
    rLog(connection, duid, direction, version, protocol, message, level = "debug") {
        if (this.logLevels[level] < this.logLevels[this.logLevel])
            return;
        const duidStr = duid ? `[${duid}] ` : "";
        const versionStr = version ? ` (PV: ${version})` : "";
        const protoStr = protocol ? ` (P: ${protocol})` : "";
        const logMsg = `[${connection}] ${duidStr}${direction}${versionStr}${protoStr} ${message}`;
        if (this.log[level]) {
            this.log[level](logMsg);
        }
        else {
            console.log(`[FALLBACK-${level}] ${logMsg}`);
        }
    }
    logMessage(level, msg, logFn) {
        if (this.logLevels[level] >= this.logLevels[this.logLevel]) {
            logFn(`[${level.toUpperCase()}] ${msg}`);
        }
    }
    constructor() {
        this.log = {
            info: (msg) => this.logMessage("info", msg, console.log),
            warn: (msg) => this.logMessage("warn", msg, console.warn),
            error: (msg) => this.logMessage("error", msg, console.error),
            debug: (msg) => this.logMessage("debug", msg, console.log),
            silly: () => { }
        };
        this.setState = this.setState.bind(this);
        this.setStateAsync = this.setStateAsync.bind(this);
        this.setStateChanged = this.setStateChanged.bind(this);
        this.http_api = {
            getMatchedRoomIDs: () => [],
            getRobotModel: () => "",
            getFwFeaturesResult: () => ({}),
            storeFwFeaturesResult: () => { }
        };
        this.translationManager = { get: (key, def) => def || key };
    }
    async setObject(id, obj) {
        this.objects[id] = obj;
    }
    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects[id]) {
            this.objects[id] = obj;
        }
    }
    extendObject = async (id, obj) => {
        this.objects[id] = { ...this.objects[id], ...obj };
    };
    async getObjectAsync(id) {
        return this.objects[id];
    }
    async delObjectAsync(id, options) {
        const recursive = options?.recursive === true;
        if (recursive) {
            const prefix = `${id}.`;
            for (const objectId of Object.keys(this.objects)) {
                if (objectId === id || objectId.startsWith(prefix)) {
                    delete this.objects[objectId];
                }
            }
            for (const stateId of Object.keys(this.states)) {
                if (stateId === id || stateId.startsWith(prefix)) {
                    delete this.states[stateId];
                }
            }
            return;
        }
        delete this.objects[id];
        delete this.states[id];
    }
    setState = (id, state, ack, callback) => {
        if (typeof ack === "function") {
            callback = ack;
            ack = undefined;
        }
        // Fire and forget / callback style
        return this.setStateAsync(id, state).then(() => {
            if (callback)
                callback();
        }).catch((e) => {
            if (callback)
                callback(e);
            throw e;
        });
    };
    setStateAsync = async (id, state) => {
        // Handle { val: ... } object or direct value
        let val = state;
        if (typeof state === "object" && state !== null && "val" in state) {
            val = state.val;
        }
        this.rLog("System", id, "Debug", undefined, undefined, `Setting state to ${val}`, "debug");
        this.states[id] = val;
        // Type Verification
        const obj = this.objects[id];
        if (obj && obj.common && obj.common.type) {
            const expectedType = obj.common.type;
            const actualType = typeof val;
            if (expectedType === "array" || expectedType === "object") {
                if (actualType !== "object" && actualType !== "string") { // Strings are sometimes allowed for JSON
                    throw new Error(`Type mismatch for ${id}. Expected ${expectedType}, got ${actualType} (${val})`);
                }
            }
            else if (expectedType === "mixed") {
                // Any type allowable
            }
            else if (actualType !== expectedType) {
                // Allow number/string auto-conversion if simple
                if (expectedType === "string" && actualType === "number")
                    return;
                // Optional: Allow null if not strictly forbidden? Usually ioBroker allows null.
                if (val === null || val === undefined)
                    return;
                // Strict check for others
                throw new Error(`Type mismatch for ${id}. Expected ${expectedType}, got ${actualType} (${val})`);
            }
        }
    };
    setStateChanged = async (id, state, ack, callback) => {
        if (typeof ack === "function") {
            callback = ack;
            ack = undefined;
        }
        let val = state;
        if (typeof state === "object" && state !== null && "val" in state) {
            val = state.val;
        }
        if (this.states[id] !== val) {
            await this.setStateAsync(id, state);
        }
        try {
            if (callback)
                callback();
        }
        catch (e) {
            if (callback)
                callback(e);
            throw e;
        }
    };
    async getStatesAsync(pattern) {
        const result = {};
        const regexPattern = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
        for (const id in this.states) {
            if (regexPattern.test(id)) {
                result[id] = { val: this.states[id], ack: true, ts: Date.now(), lc: Date.now(), from: "mock" };
            }
        }
        return Object.keys(result).length > 0 ? result : null;
    }
    async getForeignStatesAsync(pattern) {
        const patterns = Array.isArray(pattern) ? pattern : [pattern];
        const result = {};
        for (const p of patterns) {
            // Strip namespace for mock lookup if present
            const lookupPattern = p.startsWith(this.namespace + ".") ? p.substring(this.namespace.length + 1) : p;
            const matches = await this.getStatesAsync(lookupPattern);
            if (matches) {
                // We must return the original IDs (with namespace) if they were requested that way
                for (const [id, state] of Object.entries(matches)) {
                    const finalId = p.includes("*") ? id : p; // simplistic for mock
                    result[finalId] = state;
                }
            }
        }
        return Object.keys(result).length > 0 ? result : null;
    }
    async getStateAsync(id) {
        return { val: this.states[id], ack: true };
    }
    async expectState(id, expected) {
        const state = this.states[id];
        if (state === undefined) {
            throw new Error(`State ${id} not found`);
        }
        if (expected.val !== undefined && state !== expected.val) {
            throw new Error(`State ${id} expected ${expected.val} but got ${state}`);
        }
    }
}
exports.MockAdapter = MockAdapter;
//# sourceMappingURL=MockAdapter.js.map