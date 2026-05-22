"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V1MapService = void 0;
const node_util_1 = require("node:util");
const node_zlib_1 = require("node:zlib");
const MapManager_1 = require("../../../map/MapManager");
const gunzipAsync = (0, node_util_1.promisify)(node_zlib_1.gunzip);
class V1MapService {
    deps;
    duid;
    mapManager;
    adapter;
    // Mapped rooms cache (currently seems unused/null in V1VacuumFeatures but kept for compatibility)
    mappedRooms = null;
    currentMapIndex = -1;
    get currentIndex() {
        return this.currentMapIndex;
    }
    multiMaps = [];
    lastMapStatus = -1;
    constructor(deps, duid) {
        this.deps = deps;
        this.duid = duid;
        this.adapter = deps.adapter;
        this.mapManager = new MapManager_1.MapManager(this.adapter);
    }
    async updateMap() {
        try {
            // "get_map_v1" is usually the command to GET the map.
            const result = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_map_v1", [], { priority: 0 });
            let mapBuf;
            let mapVer = await this.deps.adapter.getDeviceProtocolVersion(this.duid);
            const robotModel = this.deps.adapter.http_api.getRobotModel(this.duid) || "";
            // Handle new return format { data, version } or legacy Buffer
            if (result && typeof result === "object" && "data" in result && Buffer.isBuffer(result.data)) {
                mapBuf = result.data;
                if (result.version)
                    mapVer = result.version;
            }
            else if (Buffer.isBuffer(result)) {
                mapBuf = result;
            }
            else if (result) {
                this.adapter.rLog("System", this.duid, "Debug", undefined, undefined, `get_map_v1 returned non-buffer: ${typeof result}`, "debug");
            }
            if (mapBuf) {
                const mapResult = await this.mapManager.processMap(mapBuf, mapVer, robotModel, this.duid, this.mappedRooms, this.duid, "Unknown", undefined, this.currentMapIndex);
                if (mapResult) {
                    await this.processMapResults(mapResult);
                }
            }
        }
        catch (e) {
            this.adapter.rLog("System", this.duid, "Warn", undefined, undefined, `Failed to update map: ${e.message}`, "warn");
        }
    }
    async processMapResults(mapResult) {
        if (!mapResult)
            return;
        await this.mapManager.saveGeneratedMap(this.duid, mapResult);
        // Logic to determine current floor (mapFlag) based on active map slot
        if (this.lastMapStatus !== -1 && this.lastMapStatus < 250) {
            const slotIndex = this.lastMapStatus >> 2;
            if (slotIndex >= 0 && slotIndex !== this.currentMapIndex) {
                this.currentMapIndex = slotIndex;
                this.adapter.rLog("MapManager", this.duid, "Debug", "1.0", undefined, `Updated current map index to ${this.currentMapIndex} from status ${this.lastMapStatus}`, "debug");
            }
        }
        // Only create room states for segments that are on this map – ensures rooms are 100% assigned to this floor
        if (mapResult.mapData && mapResult.mapData.IMAGE && mapResult.mapData.IMAGE.segments && Array.isArray(mapResult.mapData.IMAGE.segments.list)) {
            const currentMapFlag = this.currentMapIndex;
            await this.deps.ensureFolder(`Devices.${this.duid}.floors`);
            await this.deps.ensureFolder(`Devices.${this.duid}.floors.${currentMapFlag}`);
            for (const segment of mapResult.mapData.IMAGE.segments.list) {
                const id = segment.id;
                // Skip invalid IDs if any
                if (!id)
                    continue;
                const roomStateId = `Devices.${this.duid}.floors.${currentMapFlag}.${id}`;
                // We update the name even if the state exists, IF the state name is empty or numeric
                const segmentName = segment.name;
                let finalName = segmentName || "";
                if (String(finalName).match(/^\d+$/)) {
                    finalName = "";
                }
                const obj = await this.adapter.getObjectAsync(roomStateId);
                const currentName = obj?.common?.name;
                // If we have a new name, or if state doesn't exist, or if current name is just a number/invalid
                const isInvalidName = !currentName || String(currentName).match(/^\d+$/);
                if (!obj || (finalName && currentName !== finalName) || (isInvalidName && finalName !== currentName)) {
                    if (!obj) {
                        this.adapter.rLog("MapManager", this.duid, "Info", "1.0", undefined, `Found new room in map (ID: ${id}, Name: "${finalName}"). Adding state.`, "info");
                    }
                    else if (finalName) {
                        this.adapter.rLog("MapManager", this.duid, "Debug", "1.0", undefined, `Updating room name for ${roomStateId}: "${currentName}" -> "${finalName}"`, "debug");
                    }
                    const common = {
                        type: "boolean",
                        role: "switch",
                        write: true,
                        name: finalName || obj?.common?.name || "",
                        def: false
                    };
                    await this.deps.ensureState(roomStateId, common);
                    await this.adapter.extendObject(roomStateId, {
                        native: { id: id }
                    });
                }
            }
        }
    }
    async getCleaningRecordMap(startTime) {
        try {
            // B01 devices are handled via override/other logic.
            // V1 devices (1.0) expect an object with start_time.
            const params = { start_time: startTime };
            const cleaningRecordMapRes = (await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_clean_record_map", params, { priority: -10 })); // LOW
            let unwrapped = cleaningRecordMapRes;
            while (Array.isArray(unwrapped) && unwrapped.length === 1) {
                unwrapped = unwrapped[0];
            }
            let cleaningRecordMap;
            // Check new return format { data, version } or legacy Buffer
            if (unwrapped && typeof unwrapped === "object" && "data" in unwrapped && Buffer.isBuffer(unwrapped.data)) {
                cleaningRecordMap = unwrapped.data;
            }
            else if (Buffer.isBuffer(unwrapped)) {
                cleaningRecordMap = unwrapped;
            }
            else {
                return null;
            }
            const t0 = Date.now();
            // Check if map is gzipped (starts with 0x1f 0x8b)
            let mapBuf = cleaningRecordMap;
            if (cleaningRecordMap[0] === 0x1f && cleaningRecordMap[1] === 0x8b) {
                try {
                    mapBuf = await gunzipAsync(cleaningRecordMap);
                }
                catch (e) {
                    this.adapter.rLog("System", this.duid, "Error", undefined, undefined, `Failed to unzip map data: ${e}`, "error");
                    return null;
                }
            }
            const t1 = Date.now();
            const mapData = await this.deps.adapter.mapManager.mapParser.parsedata(mapBuf, null, { isHistoryMap: true });
            if (!mapData) {
                return null;
            }
            const t2 = Date.now();
            // Generate images
            const [mapBase64CleanUncropped, mapBase64] = await this.deps.adapter.mapManager.mapCreator.canvasMap(mapData);
            const t3 = Date.now();
            this.adapter.rLog("MapManager", this.duid, "Debug", "Profiler", undefined, `[MapProfiler] History Map ${startTime} processed. Total: ${t3 - t0}ms | Unzip: ${t1 - t0}ms | Parse: ${t2 - t1}ms | Canvas: ${t3 - t2}ms | Size: ${cleaningRecordMap.length}`, "debug");
            return {
                mapBase64CleanUncropped,
                mapBase64,
                mapData: JSON.stringify(mapData),
            };
        }
        catch (e) {
            this.adapter.rLog("System", this.duid, "Warn", undefined, undefined, `Failed to get cleaning record map: ${e.message}`, "warn");
            return null;
        }
    }
    /**
     * Fetches room mapping from API and stores it for name resolution when the map is loaded.
     * Room states are NOT created here – they are only created in processMapResults when segments
     * are present on the loaded map, so rooms exist only where they are 100% assigned to that floor.
     */
    async updateRoomMapping() {
        try {
            let rawResult = null;
            for (let i = 0; i < 3; i++) {
                rawResult = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_room_mapping", []);
                const hasMapInfo = rawResult && typeof rawResult === "object" &&
                    ((Array.isArray(rawResult) && rawResult[0] && rawResult[0].map_info) || rawResult.map_info);
                if (hasMapInfo || (Array.isArray(rawResult) && rawResult.length > 0)) {
                    break;
                }
                if (i < 2)
                    await new Promise(resolve => setTimeout(resolve, 2000));
            }
            const mapInfoFromApi = Array.isArray(rawResult) && rawResult[0] && rawResult[0].map_info
                ? rawResult[0].map_info
                : (rawResult && rawResult.map_info);
            const hasRoomsPerMap = Array.isArray(mapInfoFromApi) && mapInfoFromApi.some((m) => Array.isArray(m.rooms) && m.rooms.length > 0);
            let stored = false;
            if (hasRoomsPerMap) {
                // Store per-map room list for parser name resolution; do not create any room states here
                for (const map of mapInfoFromApi) {
                    const mapFlag = map.mapFlag ?? map.id;
                    const rooms = map.rooms;
                    if (!Array.isArray(rooms) || rooms.length === 0)
                        continue;
                    const roomEntries = rooms.map((r) => [r.id, r.iot_name_id != null ? r.iot_name_id : 0]);
                    if (this.currentMapIndex === mapFlag)
                        this.mappedRooms = roomEntries;
                    const existing = this.multiMaps.find((m) => (m.mapFlag ?? m.id) === mapFlag);
                    if (existing)
                        existing.rooms = rooms;
                }
                stored = true;
                this.adapter.rLog("MapManager", this.duid, "Info", "1.0", undefined, `[updateRoomMapping] Stored room mapping for ${mapInfoFromApi.length} maps (room states only when map is loaded)`, "info");
            }
            else {
                // Legacy: flat room list for current map only
                let result = Array.isArray(rawResult) && rawResult.length > 0 && Array.isArray(rawResult[0])
                    ? rawResult
                    : [];
                if (result.length === 0) {
                    const currentFloor = this.multiMaps.find(m => m.mapFlag === this.currentMapIndex);
                    if (currentFloor && Array.isArray(currentFloor.rooms)) {
                        result = currentFloor.rooms.map((r) => [r.id, r.iot_name_id, r.tag]);
                    }
                }
                if (result.length > 0) {
                    this.mappedRooms = result;
                    stored = true;
                    this.adapter.rLog("MapManager", this.duid, "Info", "1.0", undefined, `[updateRoomMapping] Stored room mapping for current floor (${result.length} rooms; states only when map loaded)`, "info");
                }
                else {
                    this.adapter.rLog("MapManager", this.duid, "Warn", "1.0", undefined, `[updateRoomMapping] No room mapping for Floor ${this.currentMapIndex}`, "warn");
                }
            }
            // Ensure floors parent exists (single-map / empty multi-map devices may not get it from updateMultiMapsList)
            await this.deps.ensureFolder(`Devices.${this.duid}.floors`);
            await this.deps.ensureState(`Devices.${this.duid}.floors.cleanCount`, { name: "Clean count", type: "number", write: true, def: 1 });
            return stored;
        }
        catch (e) {
            this.adapter.rLog("System", this.duid, "Warn", undefined, undefined, `Failed to update room mapping: ${e.message}`, "warn");
        }
        return false;
    }
    async updateMultiMapsList() {
        try {
            // Cast result to any[] as we expect an array response
            const result = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "get_multi_maps_list", []);
            let mapInfo = [];
            if (Array.isArray(result) && result[0] && result[0].map_info) {
                mapInfo = result[0].map_info;
            }
            else if (typeof result === "object" && result.map_info) {
                mapInfo = result.map_info;
            }
            this.multiMaps = mapInfo;
            if (mapInfo.length > 0) {
                await this.deps.ensureFolder(`Devices.${this.duid}.floors`);
                // Legacy: Global parameters from result[0] (e.g. max_multi_map)
                if (result[0]) {
                    for (const key in result[0]) {
                        if (typeof result[0][key] === "number") {
                            await this.deps.ensureState(`Devices.${this.duid}.floors.${key}`, { name: key, type: "number", write: false });
                            await this.adapter.setStateChanged(`Devices.${this.duid}.floors.${key}`, { val: result[0][key], ack: true });
                        }
                    }
                }
                const maps = {};
                for (const map of mapInfo) {
                    const mapFlag = map.mapFlag;
                    const name = map.name || `Map ${mapFlag}`;
                    const formattedTime = map.add_time ? new Date(map.add_time * 1000).toLocaleString() : "Unknown";
                    maps[mapFlag] = name;
                    // Create folder for this floor (using mapFlag as stable ID)
                    await this.deps.ensureFolder(`Devices.${this.duid}.floors.${mapFlag}`);
                    await this.adapter.extendObject(`Devices.${this.duid}.floors.${mapFlag}`, { common: { name } });
                    // Create States
                    await this.deps.ensureState(`Devices.${this.duid}.floors.${mapFlag}.name`, { name: "Floor Name", type: "string", write: false });
                    await this.adapter.setStateChanged(`Devices.${this.duid}.floors.${mapFlag}.name`, { val: name, ack: true });
                    await this.deps.ensureState(`Devices.${this.duid}.floors.${mapFlag}.mapFlag`, { name: "Map Flag", type: "number", write: false });
                    await this.adapter.setStateChanged(`Devices.${this.duid}.floors.${mapFlag}.mapFlag`, { val: mapFlag, ack: true });
                    await this.deps.ensureState(`Devices.${this.duid}.floors.${mapFlag}.add_time`, { name: "Created At", type: "string", write: false });
                    await this.adapter.setStateChanged(`Devices.${this.duid}.floors.${mapFlag}.add_time`, { val: formattedTime, ack: true });
                    // Legacy: Also keep local load button (optional but useful)
                    await this.deps.ensureState(`Devices.${this.duid}.floors.${mapFlag}.load`, { name: "Load Map", type: "boolean", role: "button", write: true, def: false });
                }
                // Legacy: Create load_multi_map command
                if (result[0] && result[0]["max_multi_map"] > 1) {
                    await this.deps.ensureState(`Devices.${this.duid}.commands.load_multi_map`, {
                        name: "Load map",
                        type: "number",
                        role: "level",
                        write: true,
                        def: 0,
                        states: maps
                    });
                }
                return mapInfo;
            }
            return null;
        }
        catch (e) {
            this.adapter.rLog("System", this.duid, "Warn", undefined, undefined, `Failed to update floors/multi-maps: ${e.message}`, "warn");
        }
        return null;
    }
    updateCurrentMapIndex(mapStatus) {
        this.lastMapStatus = mapStatus;
        if (mapStatus === undefined || mapStatus === null)
            return false;
        if (mapStatus >= 250)
            return false;
        const slotIndex = mapStatus >> 2;
        if (slotIndex >= 0 && slotIndex !== this.currentMapIndex) {
            this.currentMapIndex = slotIndex;
            // Use room mapping for new floor from multiMaps (if we have it) so parser can resolve names when map is loaded
            const floor = this.multiMaps.find((m) => (m.mapFlag ?? m.id) === slotIndex);
            this.mappedRooms = Array.isArray(floor?.rooms)
                ? floor.rooms.map((r) => [r.id, r.iot_name_id != null ? r.iot_name_id : 0])
                : null;
            return true;
        }
        return false;
    }
    resetCurrentMapIndex() {
        this.adapter.rLog("System", this.duid, "Info", undefined, undefined, "resetCurrentMapIndex: Forcing reset of map index to 0", "info");
        this.currentMapIndex = 0;
        this.lastMapStatus = -1;
    }
}
exports.V1MapService = V1MapService;
//# sourceMappingURL=V1MapService.js.map