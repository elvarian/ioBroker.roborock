"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.V1VacuumFeatures = exports.DEFAULT_PROFILE = exports.BASE_MOP = exports.BASE_WATER = exports.BASE_FAN = void 0;
const p_queue_1 = __importDefault(require("p-queue"));
const baseDeviceFeatures_1 = require("../baseDeviceFeatures");
const features_enum_1 = require("../features.enum");
const StationService_1 = require("./services/StationService");
const V1ConsumableService_1 = require("./services/V1ConsumableService");
const V1MapService_1 = require("./services/V1MapService");
const vacuumConstants_1 = require("./vacuumConstants");
// --- Shared Constants ---
exports.BASE_FAN = { 101: "Quiet", 102: "Balanced", 103: "Turbo", 104: "Max" };
exports.BASE_WATER = { 200: "Off", 201: "Mild", 202: "Moderate", 203: "Intense" };
exports.BASE_MOP = { 300: "Standard", 301: "Deep", 303: "Deep+" };
exports.DEFAULT_PROFILE = {
    mappings: {
        fan_power: exports.BASE_FAN,
        mop_mode: { 300: "Standard", 301: "Deep", 303: "Deep+" },
        water_box_mode: { 200: "Off", 201: "Mild", 202: "Moderate", 203: "Intense" },
    },
};
class V1VacuumFeatures extends baseDeviceFeatures_1.BaseDeviceFeatures {
    static autoEmptyDockStartCommand = "app_start_collect_dust";
    profile;
    consumableService;
    stationService;
    lastMapUpdate = 0;
    detectionComplete = false;
    mapService;
    constructor(dependencies, duid, robotModel, config = { staticFeatures: [] }, profile = exports.DEFAULT_PROFILE) {
        super(dependencies, duid, robotModel, config);
        // Deep clone profile to avoid mutating shared static objects
        this.profile = structuredClone(profile);
        this.consumableService = new V1ConsumableService_1.V1ConsumableService(this.deps, this.duid, this.profile);
        this.stationService = new StationService_1.StationService(this.deps, this.duid);
        this.mapService = new V1MapService_1.V1MapService(this.deps, this.duid);
    }
    async initializeDeviceData() {
        await this.updateMultiMapsList(); // 1. Load Floor List first (for names/metadata)
        await this.updateStatus(); // 2. Get Status (triggers Room sync via first floor detection)
        await this.updateMap(); // 3. Get Map Image
        // These can still be parallel as they don't depend on each other as much
        await Promise.all([
            this.updateFirmwareFeatures(),
            this.updateConsumables(),
            this.updateNetworkInfo(),
            this.updateTimers(),
        ]);
    }
    /**
     * Configures the standard command set for Protocol V1 devices.
     * @see test/unit/features_specification.test.ts for the core vacuum command list.
     */
    async setupProtocolFeatures() {
        await super.setupProtocolFeatures();
        // Add Standard V1 Commands
        const translations = this.deps.adapter.translations;
        this.addCommand("app_start", { type: "boolean", role: "button", name: translations["app_start"] || "Start", def: false });
        this.addCommand("app_stop", { type: "boolean", role: "button", name: translations["app_stop"] || "Stop", def: false });
        this.addCommand("app_pause", { type: "boolean", role: "button", name: translations["app_pause"] || "Pause", def: false });
        this.addCommand("app_charge", { type: "boolean", role: "button", name: translations["app_charge"] || "Charge", def: false });
        this.addCommand("find_me", { type: "boolean", role: "button", name: translations["find_me"] || "Find Me", def: false });
        this.addCommand("app_spot", { type: "boolean", role: "button", name: translations["app_spot"] || "Spot Cleaning", def: false });
        this.addCommand("app_segment_clean", { type: "boolean", role: "button", name: "Segment Cleaning", def: false });
        // Restore missing standard V1 commands
        this.addCommand("app_zoned_clean", { type: "json", role: "json", name: "Zone Clean" }); // No default for JSON usually, or "[]"
        this.addCommand("resume_zoned_clean", { type: "boolean", role: "button", name: "Resume Zone Clean", def: false });
        this.addCommand("stop_zoned_clean", { type: "boolean", role: "button", name: "Stop Zone Clean", def: false });
        this.addCommand("resume_segment_clean", { type: "boolean", role: "button", name: "Resume Segment Clean", def: false });
        this.addCommand("stop_segment_clean", { type: "boolean", role: "button", name: "Stop Segment Clean", def: false });
        this.addCommand("app_goto_target", { type: "json", role: "json", name: "Go To Target" });
        this.addCommand("load_multi_map", { type: "number", role: "level", name: "Load Map", def: 0 });
        this.addCommand("set_custom_mode", {
            type: "number",
            role: "level",
            name: translations["fan_power"] || "Fan Power",
            states: this.profile.mappings.fan_power,
            def: Number(Object.keys(this.profile.mappings.fan_power)[0])
        });
        // Consolidated cleaning mode with all parameters (Custom Mode)
        // We define states (Presets) to make it selectable in UI
        this.addCommand("set_clean_motor_mode", {
            type: "string",
            role: "value", // changed from json to value to support dropdown
            name: "Set Custom Cleaning Mode",
            def: this.profile.cleanMotorModePresets ? Object.keys(this.profile.cleanMotorModePresets)[0] : '{"fan_power":102,"mop_mode":300,"water_box_mode":201}',
            states: this.profile.cleanMotorModePresets || {
                '{"fan_power":102,"mop_mode":300,"water_box_mode":201}': "Indv.",
                '{"fan_power":102,"mop_mode":300,"water_box_mode":200}': "Saugen",
                '{"fan_power":105,"mop_mode":303,"water_box_mode":202}': "Wischen",
                '{"fan_power":102,"mop_mode":301,"water_box_mode":201}': "Vac & Mop",
                '{"fan_power":102,"mop_mode":306,"water_box_mode":201}': "Saugen, dann Wischen",
                '{"fan_power":106,"mop_mode":302,"water_box_mode":204}': "Smart Plan"
            }
        });
        if (this.profile.mappings.water_box_mode) {
            this.addCommand("set_water_box_custom_mode", {
                type: "number",
                role: "level",
                name: translations["water_box_mode"] || "Water Box Mode",
                states: this.profile.mappings.water_box_mode,
                def: Number(Object.keys(this.profile.mappings.water_box_mode)[0])
            });
        }
        if (this.profile.mappings.mop_mode) {
            this.addCommand("set_mop_mode", {
                type: "number",
                role: "level",
                name: translations["mop_mode"] || "Mop Mode",
                states: this.profile.mappings.mop_mode,
                def: Number(Object.keys(this.profile.mappings.mop_mode)[0])
            });
        }
        // A101 Specific: Water Box Distance Off (1-30 -> 230-85)
        if (this.profile.features?.hasDistanceOff) {
            this.addCommand("set_water_box_distance_off", {
                type: "number",
                role: "level",
                name: translations["water_box_distance_off"] || "Water Box Distance Off (1-30)",
                min: 1,
                max: 30,
                unit: "",
                def: 1
            });
        }
        this.addCommand("set_clean_repeat_times", {
            type: "number",
            role: "value",
            name: "Clean Repeat Times",
            min: 1,
            max: 2,
            def: 1,
            states: { 1: "1x", 2: "2x" }
        });
    }
    async detectAndApplyRuntimeFeatures(statusData) {
        let changed = false;
        // Detect features based on status keys
        if (("clean_area" in statusData || "clean_time" in statusData) && await this.applyFeature(features_enum_1.Feature.CleaningRecords)) {
            changed = true;
        }
        if (("map_status" in statusData) && await this.applyFeature(features_enum_1.Feature.Map)) {
            changed = true;
        }
        if (statusData["water_shortage_status"] !== undefined && await this.applyFeature(features_enum_1.Feature.WaterShortage)) {
            changed = true;
        }
        // Consumables detection (usually static, but can check for keys)
        if (await this.applyFeature(features_enum_1.Feature.Consumables))
            changed = true;
        if (statusData["dss"] !== undefined) {
            const dss = Number(statusData["dss"]);
            // DockingStationStatus: no applyFeature – folder/states created lazily in updateDockingStationStatus()
            // Bits 6-7: Dust bag status (0=not supported/missing)
            if (((dss >> 6) & 0b11) > 0) {
                await this.applyFeature(features_enum_1.Feature.AutoEmptyDock);
            }
            // Bits 4-5: Dirty water tank status (0=not supported/missing)
            // Bits 10-11: Clean water tank status
            if (((dss >> 4) & 0b11) > 0 || ((dss >> 10) & 0b11) > 0) {
                await this.applyFeature(features_enum_1.Feature.MopWash);
            }
        }
        if (!this.runtimeDetectionComplete) {
            this.runtimeDetectionComplete = true;
            changed = true;
        }
        return changed;
    }
    async updateConsumables() {
        await this.consumableService.updateConsumables();
    }
    async updateMap() {
        await this.mapService.updateMap();
    }
    async getCleaningRecordMap(startTime) {
        return this.mapService.getCleaningRecordMap(startTime);
    }
    async initDockingStationStatus() {
        await this.stationService.initDockingStationStatus();
    }
    /**
     * Updates docking station status from dss bitfield. Fully dynamic: if the device
     * sends dss in get_status, we ensure folder/states exist (lazy init) and update.
     * No per-model or feature-guard – presence of dss means the robot supports it.
     */
    async updateDockingStationStatus(dss) {
        await this.stationService.initDockingStationStatus(); // idempotent: ensure folder + states
        await this.stationService.updateDockingStationStatus(dss);
    }
    async updateMultiMapsList() {
        const mapList = await this.mapService.updateMultiMapsList();
        if (mapList && Array.isArray(mapList)) {
            // Update the load_multi_map command states to populate dropdown
            const states = {};
            for (const map of mapList) {
                states[String(map.mapFlag)] = map.name || `Map ${map.mapFlag}`;
            }
            await this.deps.adapter.extendObject(`Devices.${this.duid}.commands.load_multi_map`, {
                common: {
                    type: "number",
                    role: "value",
                    states: states
                }
            });
        }
        else {
            await super.updateMultiMapsList();
        }
    }
    async updateRoomMapping() {
        await this.mapService.updateRoomMapping();
    }
    async getCommandParams(method, params, id) {
        if (method === "reset_consumable" && id) {
            const obj = await this.deps.adapter.getObjectAsync(id);
            if (obj && obj.native && obj.native.resetParam) {
                const resetParam = obj.native.resetParam;
                this.deps.adapter.rLog("System", this.duid, "Info", "1.0", undefined, `Resetting consumable: ${resetParam} (via native param)`, "info");
                return [resetParam];
            }
            // Fallback if no native param (should not happen with new setup)
            this.deps.adapter.rLog("System", this.duid, "Warn", "1.0", undefined, `Reset consumable called without native param for ${id}`, "warn");
        }
        if (method === "set_clean_motor_mode") {
            // Log shows "set_clean_motor_mode" works, but expects params as array: [{...}]
            let finalParams = params;
            // If input is a string (e.g. from Dropdown/Presets), parse it first
            if (typeof finalParams === "string") {
                try {
                    finalParams = JSON.parse(finalParams);
                }
                catch (e) {
                    this.deps.adapter.rLog("Requests", this.duid, "Warn", this.protocolVersion || undefined, undefined, `[getCommandParams] Failed to parse set_clean_motor_mode params: ${finalParams} - Error: ${e.message}`, "warn");
                }
            }
            if (finalParams && !Array.isArray(finalParams)) {
                finalParams = [finalParams];
            }
            return {
                method: "set_clean_motor_mode",
                params: finalParams
            };
        }
        if (method === "load_multi_map") {
            // Reset current map index -> Next status update triggers room refresh
            this.mapService.resetCurrentMapIndex();
            // User request: active fetch status after map load to ensure trigger
            // We trigger these in the background immediately
            (async () => {
                await new Promise(r => setTimeout(r, 2000));
                await this.updateStatus().catch(() => { });
                await this.mapService.updateMap().catch(() => { });
                await this.mapService.updateRoomMapping().catch(() => { });
            })();
            // V1 protocol (0.6.19) expects [number] for load_multi_map
            return [params];
        }
        if (method === "app_segment_clean") {
            const repeat = await this.getCleanRepeatTimes();
            // If params are explicitly provided (e.g. from single room button), use them.
            if (params && (Array.isArray(params) || typeof params === "object")) {
                // If it's just a room ID or array of IDs, wrap it in the correct payload structure
                if (Array.isArray(params) && typeof params[0] === "number") {
                    const roomIds = params;
                    this.deps.adapter.rLog("System", this.duid, "Info", "1.0", undefined, `Starting segment cleaning for specific rooms: ${roomIds.join(", ")} with repeat ${repeat}`, "info");
                    return [{
                            segments: roomIds,
                            repeat,
                            clean_order_mode: 0,
                            clean_mop: 0
                        }];
                }
                return params;
            }
            // Gather selected rooms from floors
            const namespace = this.deps.adapter.namespace;
            // Pattern to find states under floors. Structure: Devices.<duid>.floors.<floorID>.<roomID>
            const pattern = `${namespace}.Devices.${this.duid}.floors.*.*`;
            const states = await this.deps.adapter.getStatesAsync(pattern);
            const roomIds = [];
            if (states) {
                for (const [id, state] of Object.entries(states)) {
                    if (state && (state.val === true || state.val === "true" || state.val === 1)) {
                        // Extract Room ID directly from the state path (last segment)
                        const parts = id.split(".");
                        const rid = Number(parts[parts.length - 1]);
                        if (!isNaN(rid)) {
                            roomIds.push(rid);
                        }
                    }
                }
            }
            if (roomIds.length > 0) {
                this.deps.adapter.rLog("System", this.duid, "Info", "1.0", undefined, `Starting segment cleaning for rooms: ${roomIds.join(", ")} with repeat ${repeat}`, "info");
                // Params:
                // params: [{"clean_mop":0,"clean_order_mode":0,"repeat":2,"segments":[2,1]}]
                const payload = [{
                        segments: roomIds,
                        repeat,
                        clean_order_mode: 0,
                        clean_mop: 0
                    }];
                return payload;
            }
            else {
                this.deps.adapter.rLog("System", this.duid, "Warn", "1.0", undefined, `No rooms selected for segment cleaning!`, "warn");
                return [];
            }
        }
        if (method === "set_custom_mode") {
            return [Number(params)];
        }
        if (method === "set_mop_mode") {
            return [Number(params)];
        }
        if (method === "set_water_box_custom_mode") {
            return [Number(params)];
        }
        if (method === "set_water_box_distance_off") {
            // Convert 1-30 slider to 230-85 robot value
            // Formula: 230 - ((val - 1) * 5)
            let val = Number(params);
            if (isNaN(val))
                val = 1;
            if (val < 1)
                val = 1;
            if (val > 30)
                val = 30;
            const distance_off = 230 - ((val - 1) * 5);
            return { distance_off };
        }
        if (method === "set_clean_repeat_times") {
            let repeat = Number(params);
            if (isNaN(repeat))
                repeat = 1;
            return { repeat };
        }
        if (method === V1VacuumFeatures.autoEmptyDockStartCommand) {
            return [];
        }
        return params;
    }
    normalizeCleanRepeat(value) {
        const repeat = Number(value);
        return Number.isInteger(repeat) && repeat > 0 ? repeat : null;
    }
    async getCleanRepeatTimes() {
        const commandState = await this.deps.adapter.getStateAsync(`Devices.${this.duid}.commands.set_clean_repeat_times`);
        const commandRepeat = this.normalizeCleanRepeat(commandState?.val);
        if (commandRepeat !== null)
            return commandRepeat;
        const statusState = await this.deps.adapter.getStateAsync(`Devices.${this.duid}.deviceStatus.repeat`);
        return this.normalizeCleanRepeat(statusState?.val) ?? 1;
    }
    async updateCleanSummary() {
        try {
            const result = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_clean_summary", []);
            const summary = this.normalizeV1CleanSummary(result);
            if (!summary) {
                this.deps.adapter.rLog("System", this.duid, "Warn", "1.0", undefined, "Invalid V1 clean summary format", "warn");
                return;
            }
            await this.processV1CleanSummary(summary);
        }
        catch (e) {
            this.deps.adapter.rLog("System", this.duid, "Warn", undefined, undefined, `Failed to update cleaningInfo (method: get_clean_summary): ${this.deps.adapter.errorMessage(e)}`, "warn");
        }
    }
    normalizeV1CleanSummary(result) {
        const unwrapped = this.unwrapSingleElementArrays(result);
        if (Array.isArray(unwrapped)) {
            const numericEntries = this.getIndexedNumbers(unwrapped);
            if (numericEntries.length === 0)
                return null;
            const records = this.findRecordStartTimes(unwrapped);
            const summary = this.inferV1CleanSummaryFields(numericEntries, records.length);
            for (const { index, value } of numericEntries) {
                summary[`field_${index}`] = value;
            }
            summary.records = records;
            return summary;
        }
        if (this.isPlainObject(unwrapped)) {
            const summary = { ...unwrapped };
            if (Array.isArray(summary.records)) {
                summary.records = this.normalizeRecordStartTimes(summary.records);
            }
            return summary;
        }
        return null;
    }
    inferV1CleanSummaryFields(entries, recordCount) {
        const summary = {};
        const used = new Set();
        const area = entries
            .filter(entry => entry.value >= 1_000_000)
            .sort((a, b) => b.value - a.value)[0];
        if (area) {
            summary.clean_area = area.value;
            used.add(area.index);
        }
        const count = entries
            .filter(entry => !used.has(entry.index) && entry.value >= recordCount && entry.value < 1_000_000)
            .sort((a, b) => a.value - b.value)[0];
        if (count) {
            summary.clean_count = count.value;
            used.add(count.index);
        }
        const time = entries
            .filter(entry => !used.has(entry.index))
            .sort((a, b) => b.value - a.value)[0];
        if (time) {
            summary.clean_time = time.value;
        }
        return summary;
    }
    async processV1CleanSummary(summary) {
        const records = Array.isArray(summary.records) ? this.normalizeRecordStartTimes(summary.records).sort((a, b) => b - a) : [];
        const recordPayloads = await this.fetchV1CleanRecordPayloads(records);
        const rest = { ...summary };
        delete rest.records;
        await this.deps.ensureFolder(`Devices.${this.duid}.cleaningInfo`);
        for (const key in rest) {
            await this.processResultKey("cleaningInfo", key, rest[key]);
        }
        await this.writeV1CleaningInfoJson(records, recordPayloads);
        await this.syncV1CleanRecords(records, recordPayloads);
    }
    async fetchV1CleanRecordPayloads(records) {
        const payloads = new Map();
        for (const startTime of records) {
            try {
                const rawRecord = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_clean_record", [startTime]);
                const payload = this.unwrapSingleElementArrays(rawRecord);
                if (!(Array.isArray(payload) && payload.length === 0)) {
                    payloads.set(startTime, payload);
                }
            }
            catch (e) {
                this.deps.adapter.rLog("System", this.duid, "Warn", "1.0", undefined, `Failed to fetch clean record ${startTime} for cleaningInfo.JSON: ${this.deps.adapter.errorMessage(e)}`, "warn");
            }
        }
        return payloads;
    }
    async writeV1CleaningInfoJson(records, recordPayloads) {
        const jsonRecords = records.map(startTime => recordPayloads.get(startTime) ?? null);
        await this.deps.ensureState(`Devices.${this.duid}.cleaningInfo.JSON`, {
            name: "cleaningInfoJSON",
            type: "string",
            role: "json",
            read: true,
            write: false
        });
        await this.deps.adapter.setStateChanged(`Devices.${this.duid}.cleaningInfo.JSON`, {
            val: JSON.stringify(jsonRecords),
            ack: true
        });
    }
    async syncV1CleanRecords(records, recordPayloads = new Map()) {
        if (records.length === 0)
            return;
        const mapQueue = new p_queue_1.default({ concurrency: 1 });
        const existingStartTimes = {};
        const namespace = this.deps.adapter.namespace;
        const recordIds = records.map((_, i) => `${namespace}.Devices.${this.duid}.cleaningInfo.records.${i}.startTime`);
        const states = await this.deps.adapter.getForeignStatesAsync(recordIds);
        if (states) {
            for (const id in states) {
                if (states[id] && states[id].val) {
                    const parts = id.split(".");
                    const index = parseInt(parts[parts.length - 2]);
                    if (!isNaN(index)) {
                        existingStartTimes[String(states[id].val)] = index;
                    }
                }
            }
        }
        const sortedRecords = [...records].sort((a, b) => b - a);
        const moves = [];
        const newRecs = [];
        for (let i = 0; i < sortedRecords.length; i++) {
            const time = sortedRecords[i];
            const oldIndex = existingStartTimes[time];
            if (oldIndex !== undefined && oldIndex !== i) {
                moves.push({ old: oldIndex, new: i });
            }
            else if (oldIndex === undefined) {
                newRecs.push({ index: i, time });
            }
        }
        const leftShifts = moves.filter(m => m.old > m.new).sort((a, b) => a.new - b.new);
        for (const m of leftShifts) {
            await this.copyRecordStates(m.old, m.new);
        }
        const rightShifts = moves.filter(m => m.old < m.new).sort((a, b) => b.new - a.new);
        for (const m of rightShifts) {
            await this.copyRecordStates(m.old, m.new);
        }
        for (const { index, time } of newRecs) {
            await this.fetchAndSaveRecord(time, index, index < 3 ? 10 : 0, mapQueue, recordPayloads.get(time));
        }
        await mapQueue.onIdle();
    }
    async copyRecordStates(from, to) {
        const prefix = `Devices.${this.duid}.cleaningInfo.records`;
        const states = await this.deps.adapter.getStatesAsync(`${prefix}.${from}.*`);
        if (!states)
            return;
        await Promise.all(Object.entries(states).map(async ([id, state]) => {
            if (!state || state.val === null)
                return;
            const obj = await this.deps.adapter.getObjectAsync(id);
            if (!obj?.common)
                return;
            // Replace index in path (roborock.0.Devices...records.5... -> ...records.6...)
            const destRel = id.substring(this.deps.adapter.namespace.length + 1).replace(`.records.${from}.`, `.records.${to}.`);
            await this.deps.ensureState(destRel, obj.common);
            await this.deps.adapter.setStateChanged(destRel, { val: state.val, ack: true });
        }));
    }
    async fetchAndSaveRecord(startTime, index, priority, queue, prefetchedRecord) {
        queue.add(async () => {
            try {
                const fullRecordPath = `cleaningInfo.records.${index}`;
                // 1. Set Timestamp
                await this.deps.ensureState(`Devices.${this.duid}.${fullRecordPath}.startTime`, { name: "Start Time", type: "number", role: "value.time", write: false });
                await this.deps.adapter.setStateChanged(`Devices.${this.duid}.${fullRecordPath}.startTime`, { val: startTime, ack: true });
                // 2. Fetch Metadata
                const recordsDetails = prefetchedRecord !== undefined
                    ? prefetchedRecord
                    : await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_clean_record", [startTime]);
                const record = this.normalizeV1CleanRecord(recordsDetails);
                if (record) {
                    for (const key in record) {
                        let val = record[key];
                        if (key === "area" || key === "cleaned_area")
                            val = Math.round(Number(val) / 1000000);
                        else if (key === "duration")
                            val = Math.round(Number(val) / 60);
                        await this.processResultKey(fullRecordPath, key, val);
                    }
                }
                // 3. Fetch Map only when map creation is enabled (records metadata is always saved above)
                if (this.deps.config.enable_map_creation) {
                    const mapResult = await this.mapService.getCleaningRecordMap(startTime);
                    if (mapResult) {
                        const mapFolder = `records.${index}.map`;
                        await this.deps.ensureFolder(`Devices.${this.duid}.cleaningInfo.${mapFolder}`);
                        const saveMap = async (suffix, name, val, role = "text.png") => {
                            await this.deps.ensureState(`Devices.${this.duid}.cleaningInfo.${mapFolder}.${suffix}`, { name, type: "string", role });
                            await this.deps.adapter.setStateChanged(`Devices.${this.duid}.cleaningInfo.${mapFolder}.${suffix}`, { val, ack: true });
                        };
                        await saveMap("mapBase64", "Map Image", mapResult.mapBase64);
                        await saveMap("mapData", "Map Data", mapResult.mapData, "json");
                    }
                    else {
                        this.deps.adapter.rLog("MapManager", this.duid, "Warn", "1.0", undefined, `No map found for record ${startTime}`, "warn");
                    }
                }
            }
            catch (e) {
                this.deps.adapter.rLog("System", this.duid, "Warn", "1.0", undefined, `Background fetch for record ${startTime} failed: ${e.message}`, "warn");
            }
        }, { priority });
    }
    normalizeV1CleanRecord(result) {
        const unwrapped = this.unwrapSingleElementArrays(result);
        if (Array.isArray(unwrapped)) {
            const record = this.inferV1CleanRecordFields(unwrapped);
            unwrapped.forEach((value, index) => {
                if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                    record[`field_${index}`] = value;
                }
            });
            return Object.keys(record).length > 0 ? record : null;
        }
        if (this.isPlainObject(unwrapped)) {
            return { ...unwrapped };
        }
        return null;
    }
    inferV1CleanRecordFields(values) {
        const record = {};
        const timestampPairIndex = this.findAdjacentTimestampPairIndex(values);
        if (timestampPairIndex === -1)
            return record;
        record.begin = values[timestampPairIndex];
        record.end = values[timestampPairIndex + 1];
        const duration = values[timestampPairIndex + 2];
        if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
            record.duration = duration;
        }
        const area = values[timestampPairIndex + 3];
        if (typeof area === "number" && Number.isFinite(area) && area >= 0) {
            record.area = area;
        }
        return record;
    }
    findAdjacentTimestampPairIndex(values) {
        for (let i = 0; i < values.length - 1; i++) {
            const begin = values[i];
            const end = values[i + 1];
            if (this.isUnixTimestamp(begin) && this.isUnixTimestamp(end) && begin <= end) {
                return i;
            }
        }
        return -1;
    }
    isUnixTimestamp(value) {
        return typeof value === "number" && Number.isFinite(value) && value > 946684800 && value < 4102444800;
    }
    getIndexedNumbers(values) {
        const result = [];
        values.forEach((value, index) => {
            if (typeof value === "number" && Number.isFinite(value)) {
                result.push({ index, value });
            }
        });
        return result;
    }
    findRecordStartTimes(values) {
        for (const value of values) {
            if (Array.isArray(value)) {
                const records = this.normalizeRecordStartTimes(value);
                if (records.length > 0)
                    return records;
            }
        }
        return [];
    }
    normalizeRecordStartTimes(records) {
        if (!Array.isArray(records))
            return [];
        return records.map(record => Number(record)).filter(Number.isFinite);
    }
    unwrapSingleElementArrays(value) {
        let unwrapped = value;
        while (Array.isArray(unwrapped) && unwrapped.length === 1) {
            unwrapped = unwrapped[0];
        }
        return unwrapped;
    }
    isPlainObject(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
    }
    async updateStatus() {
        try {
            const result = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_prop", ["get_status"]);
            const statusData = Array.isArray(result) ? result[0] : result;
            if (statusData && typeof statusData === "object") {
                if (!this.runtimeDetectionComplete) {
                    await this.detectAndApplyRuntimeFeatures(statusData);
                }
                await this.processStatus(statusData);
                const c = await this.deps.adapter.getStateAsync(`Devices.${this.duid}.cleaningInfo.clean_count`);
                this.deps.adapter.rLog("System", this.duid, "Debug", "1.0", undefined, `status=${statusData.state ?? "?"}, clean_count=${c?.val ?? "?"}`, "debug");
            }
        }
        catch (e) {
            this.deps.adapter.rLog("System", this.duid, "Warn", undefined, undefined, `Failed to update status: ${e.message}`, "warn");
            throw e;
        }
    }
    async updateTimers() {
        try {
            const timers = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_timer", []);
            if (Array.isArray(timers)) {
                await this.deps.ensureFolder(`Devices.${this.duid}.schedules`);
                await Promise.all(timers.map(async (timer) => {
                    // timer structure: [id, enabled, [cron, [cmd, params], createTime]]
                    if (Array.isArray(timer) && timer.length >= 3) {
                        const id = timer[0];
                        const enabled = timer[1] === "on";
                        const segments = timer[2];
                        const cron = Array.isArray(segments) ? segments[0] : "";
                        await this.deps.ensureFolder(`Devices.${this.duid}.schedules.${id}`);
                        await this.deps.ensureState(`Devices.${this.duid}.schedules.${id}.enabled`, { name: "Enabled", type: "boolean", role: "switch", write: true });
                        await this.deps.adapter.setStateChanged(`Devices.${this.duid}.schedules.${id}.enabled`, { val: enabled, ack: true });
                        await this.deps.ensureState(`Devices.${this.duid}.schedules.${id}.cron`, { name: "CRON", type: "string", role: "text", write: false });
                        await this.deps.adapter.setStateChanged(`Devices.${this.duid}.schedules.${id}.cron`, { val: cron, ack: true });
                    }
                }));
            }
        }
        catch (e) {
            this.deps.adapter.rLog("System", this.duid, "Warn", undefined, undefined, `Failed to update timers: ${e.message}`, "warn");
        }
    }
    async processStatus(status) {
        const validStatus = status || {};
        if (validStatus.dss !== undefined) {
            await this.updateDockingStationStatus(Number(validStatus.dss));
            delete validStatus.dss;
        }
        // Define property processing map
        const processors = {
            state: async (val) => {
                await this.deps.ensureState(`Devices.${this.duid}.deviceStatus.state`, { type: "number", states: this.profile.mappings.state || vacuumConstants_1.VACUUM_CONSTANTS.stateCodes });
                await this.deps.adapter.setStateChanged(`Devices.${this.duid}.deviceStatus.state`, { val, ack: true });
            },
            error_code: async (val) => {
                await this.deps.ensureState(`Devices.${this.duid}.deviceStatus.error_code`, { type: "number", states: this.profile.mappings.error_code || vacuumConstants_1.VACUUM_CONSTANTS.errorCodes });
                await this.deps.adapter.setStateChanged(`Devices.${this.duid}.deviceStatus.error_code`, { val, ack: true });
            },
            fan_power: async (val) => {
                await this.deps.ensureState(`Devices.${this.duid}.deviceStatus.fan_power`, { type: "number", states: this.profile.mappings.fan_power });
                await this.deps.adapter.setStateChanged(`Devices.${this.duid}.deviceStatus.fan_power`, { val, ack: true });
                // Sync to command state
                await this.deps.adapter.setStateChanged(`Devices.${this.duid}.commands.set_custom_mode`, { val, ack: true });
            },
            mop_mode: async (val) => {
                if (this.profile.mappings.mop_mode) {
                    await this.deps.ensureState(`Devices.${this.duid}.deviceStatus.mop_mode`, { type: "number", states: this.profile.mappings.mop_mode });
                    await this.deps.adapter.setStateChanged(`Devices.${this.duid}.deviceStatus.mop_mode`, { val, ack: true });
                    // Sync to command state
                    await this.deps.adapter.setStateChanged(`Devices.${this.duid}.commands.set_mop_mode`, { val, ack: true });
                }
            },
            water_box_mode: async (val) => {
                if (this.profile.mappings.water_box_mode) {
                    await this.deps.ensureState(`Devices.${this.duid}.deviceStatus.water_box_mode`, { type: "number", states: this.profile.mappings.water_box_mode });
                    await this.deps.adapter.setStateChanged(`Devices.${this.duid}.deviceStatus.water_box_mode`, { val, ack: true });
                    // Sync to command state
                    await this.deps.adapter.setStateChanged(`Devices.${this.duid}.commands.set_water_box_custom_mode`, { val, ack: true });
                }
            }
        };
        // Parallel processing of remaining status properties
        const promises = [];
        for (const key in validStatus) {
            if (processors[key]) {
                promises.push(processors[key](validStatus[key]));
            }
            else {
                // Default handler for generic properties
                promises.push(this.processResultKey("deviceStatus", key, validStatus[key]));
            }
        }
        await Promise.all(promises);
    }
    getDynamicFeatures() {
        // v1 dynamic features
        const features = new Set();
        if (this.config.staticFeatures) {
            this.config.staticFeatures.forEach(f => features.add(f));
        }
        return features;
    }
    // --- Abstract Method Implementations ---
    getCommonConsumable(attribute) {
        return vacuumConstants_1.VACUUM_CONSTANTS.consumables[attribute];
    }
    isResetableConsumable(consumable) {
        return vacuumConstants_1.VACUUM_CONSTANTS.resetConsumables.has(consumable);
    }
    getCommonDeviceStates(attribute) {
        return vacuumConstants_1.VACUUM_CONSTANTS.deviceStates[attribute];
    }
    getCommonCleaningRecords(attribute) {
        return vacuumConstants_1.VACUUM_CONSTANTS.cleaningRecords[attribute];
    }
    getFirmwareFeatureName(featureID) {
        return vacuumConstants_1.VACUUM_CONSTANTS.firmwareFeatures[featureID] || `Feature ${featureID}`;
    }
    getCommonCleaningInfo(attribute) {
        return vacuumConstants_1.VACUUM_CONSTANTS.cleaningInfo[attribute];
    }
    async initAutoEmptyDock() {
        this.addCommand(V1VacuumFeatures.autoEmptyDockStartCommand, {
            type: "boolean",
            role: "button",
            name: "Start Collect Dust",
            def: false
        });
    }
    async initMopWash() {
        this.addCommand("app_start_wash", {
            type: "boolean",
            role: "button",
            name: "Start Mop Wash",
            def: false
        });
        this.addCommand("app_stop_wash", {
            type: "boolean",
            role: "button",
            name: "Stop Mop Wash",
            def: false
        });
    }
    async initMopDry() {
        this.addCommand("app_start_mop_drying", {
            type: "boolean",
            role: "button",
            name: "Start Mop Drying",
            def: false
        });
        this.addCommand("app_stop_mop_drying", {
            type: "boolean",
            role: "button",
            name: "Stop Mop Drying",
            def: false
        });
    }
    async processResultKey(folder, key, val) {
        if (key === "map_status") {
            const mapIdxChanged = this.mapService.updateCurrentMapIndex(Number(val));
            if (mapIdxChanged) {
                this.deps.adapter.rLog("MapManager", this.duid, "Info", "1.0", undefined, `[MapSync] Map changed to index ${this.mapService.currentIndex}. Updating room mapping.`, "info");
                await this.updateRoomMapping();
            }
        }
        else if (key === "clean_time") {
            // cleaningInfo (Total) = Hours, deviceStatus (Current) = Minutes
            const divisor = folder.includes("cleaningInfo") ? 3600 : 60;
            val = Math.round(Number(val) / divisor);
        }
        else if (key === "clean_area") {
            val = Math.round(Number(val) / 1000000); // mm² -> m²
        }
        await super.processResultKey(folder, key, val);
    }
    getCurrentMapIndex() {
        return this.mapService.currentIndex;
    }
}
exports.V1VacuumFeatures = V1VacuumFeatures;
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.Consumables),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "updateConsumables", null);
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.Map),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "updateMap", null);
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.DockingStationStatus),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "initDockingStationStatus", null);
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.MultiMap),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "updateMultiMapsList", null);
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.RoomMapping),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "updateRoomMapping", null);
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.AutoEmptyDock),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "initAutoEmptyDock", null);
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.MopWash),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "initMopWash", null);
__decorate([
    baseDeviceFeatures_1.BaseDeviceFeatures.DeviceFeature(features_enum_1.Feature.MopDry),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], V1VacuumFeatures.prototype, "initMopDry", null);
//# sourceMappingURL=v1VacuumFeatures.js.map