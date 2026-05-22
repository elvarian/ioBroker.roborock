"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapManager = void 0;
const B01MapPipeline_1 = require("./b01/B01MapPipeline");
const MapBuilder_1 = require("./b01/MapBuilder");
const Q10MapBuilder_1 = require("./q10/Q10MapBuilder");
const Q10MapCreator_1 = require("./q10/Q10MapCreator");
const Q10YxMapParser_1 = require("./q10/Q10YxMapParser");
const MapBuilder_2 = require("./v1/MapBuilder");
const MapDecryptor_1 = require("./v1/MapDecryptor");
const MapParser_1 = require("./v1/MapParser");
class MapManager {
    adapter;
    mapParser;
    mapCreator;
    pipelineB01;
    builderB01;
    creatorQ10;
    builderQ10;
    q10StateByDevice = new Map();
    q10PendingPathPreludeByDevice = new Map();
    latestB01DeviceStatusByDevice = new Map();
    static NON_Q10_CLASSIFICATION = {
        isQ10Payload: false,
        isLiveMapCandidate: false,
        payloadShape: "map",
        blobType: null,
        mapData: null,
        pathPoints: null
    };
    static EMPTY_Q10_OVERLAY_COUNTS = {
        virtualWalls: 0,
        forbidAreas: 0,
        mopAreas: 0,
        thresholdAreas: 0,
        eraseAreas: 0,
        carpetAreas: 0
    };
    static Q10_PATH_PRELUDE_TTL_MS = 30_000;
    constructor(adapter) {
        this.adapter = adapter;
        this.mapParser = new MapParser_1.MapParser(adapter);
        this.mapCreator = new MapBuilder_2.MapBuilder(adapter);
        this.pipelineB01 = new B01MapPipeline_1.B01MapPipeline(adapter);
        this.builderB01 = new MapBuilder_1.MapBuilder(adapter);
        this.creatorQ10 = new Q10MapCreator_1.Q10MapCreator(adapter);
        this.builderQ10 = new Q10MapBuilder_1.Q10MapBuilder(adapter);
    }
    /**
     * Processes raw map data and returns a generated map buffer.
     * @param rawData The raw buffer from the robot (Protocol 301).
     * @param version The protocol version string (e.g., "B01" or "1.0").
     * @param model The robot model (used for key derivation/assets).
     * @param serial The robot serial (used for key derivation).
     * @param mappedRooms Optional room mapping for V1.
     * @param currentMapIndex Optional floor index for V1; when set and mappedRooms empty, segment names are enriched from room states.
     */
    async processMap(rawData, version, model, serial, mappedRooms, duid, connectionType = "Unknown", deviceStatus, currentMapIndex) {
        try {
            if (version === "B01" || version === "Q10") {
                const resolved = this.pipelineB01.resolve(rawData, version, model, serial, duid || "", connectionType);
                if (resolved?.variant === "q10") {
                    const effectiveDeviceStatus = duid
                        ? await this.getDeviceStatusForB01(duid, deviceStatus)
                        : deviceStatus;
                    const q10Result = await this.processQ10Payload({ classification: resolved.q10, mapData: resolved.mapData }, duid, connectionType, effectiveDeviceStatus, model || undefined);
                    if (q10Result) {
                        return q10Result;
                    }
                }
                if (resolved?.variant === "protobuf") {
                    const mapData = resolved.mapData;
                    const effectiveDeviceStatus = duid
                        ? await this.getDeviceStatusForB01(duid, deviceStatus)
                        : deviceStatus;
                    const expectedGridSize = mapData.header.sizeX * mapData.header.sizeY;
                    // Only accept when grid length exactly matches header (real maps); reject wrong decryption, fragments, or non-map packets.
                    if (expectedGridSize > 0 && mapData.mapGrid.length !== expectedGridSize) {
                        this.adapter.rLog(connectionType, duid || "unknown", "Warn", version, 301, `B01 map rejected: grid size inconsistent with header (got ${mapData.mapGrid.length}, expected sizeX*sizeY=${expectedGridSize})`, "warn");
                    }
                    else {
                        const mapBuf = await this.builderB01.buildMap(mapData, model, duid, effectiveDeviceStatus);
                        const mapBase64 = "data:image/png;base64," + mapBuf.toString("base64");
                        return {
                            mapBase64: mapBase64,
                            mapBase64Clean: mapBase64, // Reuse same map for clean view for now
                            mapData: mapData
                        };
                    }
                }
            }
            else {
                // V1 Handling with MapDecryptor (GZIP)
                const mapBuf = await MapDecryptor_1.MapDecryptor.decrypt(rawData);
                if (!mapBuf) {
                    this.adapter.rLog("MapManager", duid || null, "Error", version, 301, `Failed to unzip V1 map data`, "error");
                    return null;
                }
                // V1 parser returns ParsedMapData OR empty object
                const mapData = await this.mapParser.parsedata(mapBuf, mappedRooms, { isHistoryMap: false, duid: duid ?? undefined });
                // For cloud robots mappedRooms may be empty; enrich segment names from room states when possible
                if (mapData && Object.keys(mapData).length > 0 && duid != null && "IMAGE" in mapData) {
                    const floor = (currentMapIndex != null && currentMapIndex >= 0) ? currentMapIndex : 0;
                    const list = mapData.IMAGE?.segments?.list;
                    if (Array.isArray(list) && (!mappedRooms || mappedRooms.length === 0)) {
                        for (const seg of list) {
                            if (seg.id != null && !seg.name) {
                                const obj = await this.adapter.getObjectAsync(`Devices.${duid}.floors.${floor}.${seg.id}`);
                                const name = obj?.common?.name;
                                if (name && String(name).trim())
                                    seg.name = String(name).trim();
                            }
                        }
                    }
                }
                if (mapData && Object.keys(mapData).length > 0) {
                    // Legacy MapCreator returns [clean, full]
                    // We cast builderV1 to any to avoid type issues if CanvasMap isn't explicitly typed in class definition yet
                    const [mapBase64Clean, mapBase64] = await this.mapCreator.canvasMap(mapData, { mappedRooms, model, duid: duid ?? undefined });
                    return {
                        mapBase64: mapBase64,
                        mapBase64Clean: mapBase64Clean,
                        mapData: mapData
                    };
                }
            }
        }
        catch (e) {
            this.adapter.rLog("MapManager", duid || null, "Error", version, 301, `Failed to process map (Version: ${version}): ${this.adapter.errorMessage(e)}`, "error");
        }
        return null;
    }
    async processQ10Payload(q10Payload, duid, connectionType = "Unknown", deviceStatus, robotModel) {
        const cacheKey = this.getQ10CacheKey(duid, connectionType);
        const previous = this.q10StateByDevice.get(cacheKey);
        const { classification } = q10Payload;
        const packetKind = classification.mapData ? "full" : "path-only";
        const rawMapData = q10Payload.mapData ?? classification.mapData;
        const rawOverlayCounts = rawMapData?.q10RawOverlayCounts ?? this.getQ10OverlayCounts(rawMapData);
        const sourceOverlayCounts = this.getQ10OverlayCounts(rawMapData);
        let overlaySeedSource = this.hasQ10OverlaySeed(rawMapData) ? "inline" : "none";
        let mapData = rawMapData;
        if (mapData) {
            if (connectionType !== "B01History") {
                const pendingPrelude = this.consumeQ10PendingPathPrelude(cacheKey);
                if (pendingPrelude && !(mapData.q10SourceData?.pathPoints?.length ?? 0)) {
                    mapData = (0, Q10YxMapParser_1.applyQ10PathOnlyToB01)(mapData, pendingPrelude);
                }
                mapData = (0, Q10YxMapParser_1.mergeQ10RuntimeState)(mapData, previous);
                if (overlaySeedSource === "none" &&
                    this.hasQ10OverlaySeed(mapData) &&
                    this.isCompatibleQ10OverlaySeed(rawMapData, previous)) {
                    overlaySeedSource = "runtime-cache";
                }
            }
        }
        else {
            const pathPoints = classification.pathPoints;
            if (!pathPoints?.length) {
                return null;
            }
            if (!previous) {
                if (connectionType !== "B01History") {
                    this.storeQ10PendingPathPrelude(cacheKey, pathPoints);
                }
                return null;
            }
            mapData = (0, Q10YxMapParser_1.applyQ10PathOnlyToB01)(previous, pathPoints);
            if (overlaySeedSource === "none" && this.hasQ10OverlaySeed(mapData)) {
                overlaySeedSource = "runtime-cache";
            }
        }
        const created = this.creatorQ10.create(mapData, deviceStatus);
        created.q10RuntimeDebug = this.buildQ10RuntimeDebugSummary(created, packetKind, classification, rawOverlayCounts, sourceOverlayCounts, overlaySeedSource);
        const resolvedRobotModel = robotModel || (duid ? this.adapter.http_api?.getRobotModel(duid) || undefined : undefined);
        const rendered = await this.builderQ10.buildMaps(created, deviceStatus, resolvedRobotModel);
        const mapBase64 = "data:image/png;base64," + rendered.full.toString("base64");
        const mapBase64Clean = "data:image/png;base64," + rendered.clean.toString("base64");
        this.q10StateByDevice.set(cacheKey, created);
        return {
            mapBase64,
            mapBase64Clean,
            mapData: created
        };
    }
    async applyQ10LiveStatePatch(duid, patch) {
        if (!duid)
            return false;
        const cacheKey = this.getQ10CacheKey(duid, "B01");
        const current = this.q10StateByDevice.get(cacheKey);
        if (!current?.q10SourceData)
            return false;
        const patched = (0, Q10YxMapParser_1.applyQ10RuntimeStatePatch)(current, patch);
        if (patched === current)
            return false;
        const deviceStatus = await this.getDeviceStatusForB01(duid);
        const robotModel = this.adapter.http_api?.getRobotModel(duid) || undefined;
        const created = this.creatorQ10.create(patched, deviceStatus);
        created.q10RuntimeDebug = this.buildQ10RuntimeDebugSummary(created, "full", MapManager.NON_Q10_CLASSIFICATION, current.q10RawOverlayCounts ?? this.getQ10OverlayCounts(current), this.getQ10OverlayCounts(created), current.q10RuntimeDebug?.overlaySeedSource ?? "none");
        const rendered = await this.builderQ10.buildMaps(created, deviceStatus, robotModel);
        const result = {
            mapBase64: "data:image/png;base64," + rendered.full.toString("base64"),
            mapBase64Clean: "data:image/png;base64," + rendered.clean.toString("base64"),
            mapData: created
        };
        this.q10StateByDevice.set(cacheKey, created);
        await this.saveGeneratedMap(duid, result);
        return true;
    }
    buildQ10RuntimeDebugSummary(mapData, packetKind, classification = MapManager.NON_Q10_CLASSIFICATION, rawOverlayCounts = MapManager.EMPTY_Q10_OVERLAY_COUNTS, sourceOverlayCounts = MapManager.EMPTY_Q10_OVERLAY_COUNTS, overlaySeedSource = "none") {
        const verification = mapData.q10Verification;
        return {
            packetKind,
            payloadShape: classification.payloadShape,
            overlaySeedSource,
            overlaySeedHydrated: overlaySeedSource === "runtime-cache",
            rawVirtualWalls: rawOverlayCounts.virtualWalls,
            rawForbidAreas: rawOverlayCounts.forbidAreas,
            rawMopAreas: rawOverlayCounts.mopAreas,
            rawThresholdAreas: rawOverlayCounts.thresholdAreas,
            rawEraseAreas: rawOverlayCounts.eraseAreas,
            rawCarpetAreas: rawOverlayCounts.carpetAreas,
            sourceVirtualWalls: sourceOverlayCounts.virtualWalls,
            sourceForbidAreas: sourceOverlayCounts.forbidAreas,
            sourceMopAreas: sourceOverlayCounts.mopAreas,
            sourceThresholdAreas: sourceOverlayCounts.thresholdAreas,
            sourceEraseAreas: sourceOverlayCounts.eraseAreas,
            sourceCarpetAreas: sourceOverlayCounts.carpetAreas,
            pathPoints: mapData.q10SourceData?.pathPoints.length ?? mapData.q10CreatorData?.pathPixels.length ?? 0,
            historyPoints: mapData.history?.length ?? 0,
            virtualWalls: mapData.q10SourceData?.virtualWalls.length ?? mapData.virtualWalls?.length ?? 0,
            forbidAreas: mapData.q10SourceData?.forbidAreas.length ?? mapData.recmForbitZone?.length ?? 0,
            mopAreas: mapData.q10SourceData?.mopAreas.length ?? 0,
            thresholdAreas: mapData.q10SourceData?.thresholdAreas.length ?? mapData.thresholds?.length ?? 0,
            eraseAreas: mapData.q10SourceData?.eraseAreas.length ?? mapData.eraseAreas?.length ?? 0,
            carpetAreas: mapData.q10SourceData?.carpetAreas.length ?? mapData.carpetInfo?.length ?? 0,
            obstacles: mapData.q10SourceData?.obstacles.length ?? mapData.obstacles?.length ?? 0,
            skipPoints: mapData.q10SourceData?.skipPoints.length ?? mapData.skipCleanPoints?.length ?? 0,
            suspectedPoints: mapData.q10SourceData?.suspectedPoints.length ?? mapData.q10CreatorData?.suspectedPoints.length ?? 0,
            rooms: mapData.q10SourceData?.rooms.length ?? mapData.rooms?.length ?? 0,
            robotPresent: !!(mapData.q10CreatorData?.robotPixel || mapData.robotPos),
            chargerPresent: !!(mapData.q10CreatorData?.chargerPixel || mapData.chargerPos),
            presentVerifiedFeatures: verification?.presentVerifiedFeatures ?? [],
            presentUnverifiedFeatures: verification?.presentUnverifiedFeatures ?? []
        };
    }
    getQ10CacheKey(duid, connectionType = "Unknown") {
        const scope = connectionType === "B01History" ? "history" : "live";
        return `${duid || "unknown"}:${scope}`;
    }
    storeQ10PendingPathPrelude(cacheKey, pathPoints) {
        this.q10PendingPathPreludeByDevice.set(cacheKey, {
            pathPoints: pathPoints.map((point) => ({ ...point })),
            receivedAt: Date.now()
        });
    }
    consumeQ10PendingPathPrelude(cacheKey) {
        const pending = this.q10PendingPathPreludeByDevice.get(cacheKey);
        if (!pending)
            return null;
        this.q10PendingPathPreludeByDevice.delete(cacheKey);
        if (Date.now() - pending.receivedAt > MapManager.Q10_PATH_PRELUDE_TTL_MS) {
            return null;
        }
        return pending.pathPoints.map((point) => ({ ...point }));
    }
    hasQ10OverlaySeed(mapData) {
        const source = mapData?.q10SourceData;
        if (!source)
            return false;
        return [
            source.virtualWalls,
            source.forbidAreas,
            source.mopAreas,
            source.thresholdAreas,
            source.eraseAreas,
            source.carpetAreas
        ].some((areas) => (areas?.length ?? 0) > 0);
    }
    getQ10OverlayCounts(mapData) {
        const source = mapData?.q10SourceData;
        if (!source)
            return { ...MapManager.EMPTY_Q10_OVERLAY_COUNTS };
        return {
            virtualWalls: source.virtualWalls.length,
            forbidAreas: source.forbidAreas.length,
            mopAreas: source.mopAreas.length,
            thresholdAreas: source.thresholdAreas.length,
            eraseAreas: source.eraseAreas.length,
            carpetAreas: source.carpetAreas.length
        };
    }
    isCompatibleQ10OverlaySeed(current, candidate) {
        if (!candidate?.q10SourceData)
            return false;
        if (!this.hasQ10OverlaySeed(candidate))
            return false;
        const currentMapId = current.q10SourceData?.mapId;
        const candidateMapId = candidate.q10SourceData?.mapId;
        if (Number.isFinite(currentMapId) &&
            Number.isFinite(candidateMapId) &&
            currentMapId &&
            candidateMapId &&
            currentMapId !== candidateMapId) {
            return false;
        }
        const currentHeader = current.header;
        const candidateHeader = candidate.header;
        if (currentHeader.sizeX !== candidateHeader.sizeX || currentHeader.sizeY !== candidateHeader.sizeY) {
            return false;
        }
        const tolerance = Math.max(currentHeader.resolution, candidateHeader.resolution, 0.05) * 2;
        return (Math.abs(currentHeader.minX - candidateHeader.minX) <= tolerance &&
            Math.abs(currentHeader.minY - candidateHeader.minY) <= tolerance &&
            Math.abs(currentHeader.maxX - candidateHeader.maxX) <= tolerance &&
            Math.abs(currentHeader.maxY - candidateHeader.maxY) <= tolerance &&
            Math.abs(currentHeader.resolution - candidateHeader.resolution) <= tolerance);
    }
    updateB01DeviceStatus(duid, status) {
        if (!duid)
            return;
        const current = this.latestB01DeviceStatusByDevice.get(duid) ?? {};
        this.latestB01DeviceStatusByDevice.set(duid, {
            ...current,
            ...status
        });
    }
    async readPersistedB01DeviceStatus(duid) {
        const getVal = async (keys) => {
            for (const k of keys) {
                const s = await this.adapter.getStateAsync(`Devices.${duid}.deviceStatus.${k}`);
                if (s && s.val !== undefined && s.val !== null)
                    return s.val;
            }
            return undefined;
        };
        const stateVal = await getVal(["status", "state", "4"]);
        const workModeVal = await getVal(["work_mode", "workMode", "15"]);
        const cleanModeVal = await getVal(["mode", "cleanMode", "17"]);
        const dustCollectVal = await getVal(["dust_action", "dust_collection_status", "105"]);
        const faultVal = await getVal(["fault", "deviceFault", "18"]);
        const persisted = {};
        if (stateVal !== undefined)
            persisted.deviceState = Number(stateVal);
        if (workModeVal !== undefined)
            persisted.deviceWorkMode = Number(workModeVal);
        if (cleanModeVal !== undefined)
            persisted.deviceCleanMode = Number(cleanModeVal);
        if (dustCollectVal !== undefined) {
            persisted.isDustCollect = dustCollectVal === 1 || dustCollectVal === true || dustCollectVal === "1";
        }
        if (faultVal !== undefined)
            persisted.deviceFault = Number(faultVal);
        return persisted;
    }
    pickB01StatusValue(...values) {
        for (const value of values) {
            if (value !== undefined && value !== null)
                return value;
        }
        return undefined;
    }
    async getDeviceStatusForB01(duid, preferred) {
        const persisted = await this.readPersistedB01DeviceStatus(duid);
        const cached = this.latestB01DeviceStatusByDevice.get(duid);
        return {
            deviceState: this.pickB01StatusValue(preferred?.deviceState, cached?.deviceState, persisted.deviceState, 0) ?? 0,
            deviceWorkMode: this.pickB01StatusValue(preferred?.deviceWorkMode, cached?.deviceWorkMode, persisted.deviceWorkMode, 0) ?? 0,
            deviceCleanMode: this.pickB01StatusValue(preferred?.deviceCleanMode, cached?.deviceCleanMode, persisted.deviceCleanMode, 0),
            deviceChargeState: this.pickB01StatusValue(preferred?.deviceChargeState, cached?.deviceChargeState, persisted.deviceChargeState),
            isDustCollect: this.pickB01StatusValue(preferred?.isDustCollect, cached?.isDustCollect, persisted.isDustCollect, false) ?? false,
            deviceFault: this.pickB01StatusValue(preferred?.deviceFault, cached?.deviceFault, persisted.deviceFault, 0),
            deviceQuiet: this.pickB01StatusValue(preferred?.deviceQuiet, cached?.deviceQuiet, persisted.deviceQuiet),
            devicePvCutCharge: this.pickB01StatusValue(preferred?.devicePvCutCharge, cached?.devicePvCutCharge, persisted.devicePvCutCharge),
            deviceBattery: this.pickB01StatusValue(preferred?.deviceBattery, cached?.deviceBattery, persisted.deviceBattery),
            deviceCustomType: this.pickB01StatusValue(preferred?.deviceCustomType, cached?.deviceCustomType, persisted.deviceCustomType)
        };
    }
    /**
     * Saves the generated map results to ioBroker states.
     * @param duid Device Unique ID
     * @param res The processed map result object
     */
    async saveGeneratedMap(duid, res) {
        if (!res)
            return;
        try {
            await this.adapter.ensureFolder(`Devices.${duid}.map`);
            const tasks = [];
            if (res.mapBase64) {
                tasks.push(this.adapter.ensureState(`Devices.${duid}.map.mapBase64`, { name: "Map Image", type: "string", role: "text.png" })
                    .then(() => this.adapter.setStateChangedAsync(`Devices.${duid}.map.mapBase64`, { val: res.mapBase64, ack: true })));
            }
            if (res.mapBase64Clean) {
                tasks.push(this.adapter.ensureState(`Devices.${duid}.map.mapBase64Clean`, { name: "Map Image (Clean)", type: "string", role: "text.png" })
                    .then(() => this.adapter.setStateChangedAsync(`Devices.${duid}.map.mapBase64Clean`, { val: res.mapBase64Clean, ack: true })));
            }
            if (res.mapData) {
                tasks.push(this.adapter.ensureState(`Devices.${duid}.map.mapData`, { name: "Map Data", type: "string", role: "json" })
                    .then(() => this.adapter.setStateChangedAsync(`Devices.${duid}.map.mapData`, { val: JSON.stringify(res.mapData), ack: true })));
            }
            await Promise.all(tasks);
        }
        catch (e) {
            this.adapter.rLog("MapManager", duid, "Error", "Map", undefined, `Failed to save map states: ${this.adapter.errorMessage(e)}`, "error");
        }
    }
}
exports.MapManager = MapManager;
//# sourceMappingURL=MapManager.js.map