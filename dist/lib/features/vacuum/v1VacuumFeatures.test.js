"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const features_enum_1 = require("../features.enum");
const v1VacuumFeatures_1 = require("./v1VacuumFeatures");
// Mock MapManager
vitest_1.vi.mock("../../map/MapManager", () => {
    return {
        MapManager: class {
            processMap = vitest_1.vi.fn().mockResolvedValue({ mapBase64: "base64_map" });
        }
    };
});
(0, vitest_1.describe)("V1VacuumFeatures", () => {
    let adapterMock;
    let depsMock;
    let requestsHandlerMock;
    (0, vitest_1.beforeEach)(() => {
        requestsHandlerMock = {
            sendRequest: vitest_1.vi.fn().mockResolvedValue({}),
            command: vitest_1.vi.fn().mockResolvedValue(undefined),
            mapParser: { parsedata: vitest_1.vi.fn().mockResolvedValue({}) },
            mapCreator: { canvasMap: vitest_1.vi.fn().mockResolvedValue(["", "", ""]) }
        };
        adapterMock = {
            namespace: "roborock.0",
            log: { info: vitest_1.vi.fn(), error: vitest_1.vi.fn(), warn: vitest_1.vi.fn(), debug: vitest_1.vi.fn(), silly: vitest_1.vi.fn() },
            setStateChanged: vitest_1.vi.fn().mockResolvedValue(undefined),
            setState: vitest_1.vi.fn(),
            ensureState: vitest_1.vi.fn().mockResolvedValue(undefined),
            ensureFolder: vitest_1.vi.fn().mockResolvedValue(undefined),
            getStateAsync: vitest_1.vi.fn().mockResolvedValue(undefined),
            getStatesAsync: vitest_1.vi.fn().mockResolvedValue({}),
            getObjectAsync: vitest_1.vi.fn().mockResolvedValue({ common: {} }),
            extendObject: vitest_1.vi.fn().mockResolvedValue(undefined),
            setObject: vitest_1.vi.fn().mockResolvedValue(undefined),
            setObjectNotExistsAsync: vitest_1.vi.fn().mockResolvedValue(undefined),
            requestsHandler: requestsHandlerMock,
            getDeviceProtocolVersion: vitest_1.vi.fn().mockResolvedValue("1.0"),
            translations: {},
            http_api: {
                getFwFeaturesResult: vitest_1.vi.fn(),
                storeFwFeaturesResult: vitest_1.vi.fn(),
                getRobotModel: vitest_1.vi.fn().mockReturnValue("roborock.vacuum.a70"),
                getDevices: vitest_1.vi.fn().mockReturnValue([]) // For V1ConsumableService
            },
            rLog: vitest_1.vi.fn(),
            translationManager: {
                get: vitest_1.vi.fn().mockImplementation((key, def) => def || key),
            },
        };
        depsMock = {
            adapter: adapterMock,
            http_api: { storeFwFeaturesResult: vitest_1.vi.fn(), getFwFeaturesResult: vitest_1.vi.fn() },
            ensureState: vitest_1.vi.fn().mockResolvedValue(undefined), // deps.ensureState
            ensureFolder: vitest_1.vi.fn().mockResolvedValue(undefined),
            log: adapterMock.log,
            config: { staticFeatures: [] }
        };
    });
    class TestVacuum extends v1VacuumFeatures_1.V1VacuumFeatures {
        getDynamicFeatures() {
            return new Set();
        }
        async detectAndApplyRuntimeFeatures() {
            return false;
        }
    }
    (0, vitest_1.it)("should parse dss bitmask correctly in updateDockingStationStatus", async () => {
        const vacuum = new TestVacuum(depsMock, "duid1", "roborock.vacuum.a70", { staticFeatures: [features_enum_1.Feature.DockingStationStatus] });
        // 15995 (dec) = 11111001111011 (bin)
        const dss = 15995;
        await vacuum.initialize();
        console.log("Applied Features after init:", Array.from(vacuum.appliedFeatures));
        await vacuum.updateDockingStationStatus(dss);
        const calls = adapterMock.setStateChanged.mock.calls;
        // Filter calls for dockingStationStatus
        const dssCalls = calls.filter((c) => c[0].includes("dockingStationStatus"));
        const isUpdown = dssCalls.find((c) => c[0].endsWith("isUpdownWaterReady"));
        (0, vitest_1.expect)(isUpdown).toBeDefined();
        (0, vitest_1.expect)(isUpdown[1]).toHaveProperty("val", 3);
        const clearBox = dssCalls.find((c) => c[0].endsWith("clearWaterBoxStatus"));
        (0, vitest_1.expect)(clearBox).toBeDefined();
        (0, vitest_1.expect)(clearBox[1]).toHaveProperty("val", 2);
    });
    (0, vitest_1.it)("should parse get_multi_maps_list and create floors structure", async () => {
        const vacuum = new TestVacuum(depsMock, "duid1", "roborock.vacuum.a70", { staticFeatures: [] });
        // Mock response
        const mapResponse = [{
                max_multi_map: 4,
                max_bak_map: 1,
                multi_map_count: 2,
                map_info: [
                    { name: "Ground Floor", mapFlag: 0, add_time: 1600000000 },
                    { name: undefined, mapFlag: 1, add_time: 1600000001 }
                ]
            }];
        requestsHandlerMock.sendRequest.mockResolvedValue(mapResponse);
        await vacuum.updateMultiMapsList();
        // Check Folder Creation
        (0, vitest_1.expect)(depsMock.ensureFolder).toHaveBeenCalledWith("Devices.duid1.floors");
        (0, vitest_1.expect)(depsMock.ensureFolder).toHaveBeenCalledWith("Devices.duid1.floors.0");
        (0, vitest_1.expect)(depsMock.ensureFolder).toHaveBeenCalledWith("Devices.duid1.floors.1");
        // Check States
        // Floor 0
        (0, vitest_1.expect)(adapterMock.setStateChanged).toHaveBeenCalledWith(vitest_1.expect.stringContaining("Devices.duid1.floors.0.name"), { val: "Ground Floor", ack: true });
        (0, vitest_1.expect)(adapterMock.setStateChanged).toHaveBeenCalledWith(vitest_1.expect.stringContaining("Devices.duid1.floors.0.mapFlag"), { val: 0, ack: true });
        // Floor 1 (Name fallback)
        (0, vitest_1.expect)(adapterMock.setStateChanged).toHaveBeenCalledWith(vitest_1.expect.stringContaining("Devices.duid1.floors.1.name"), { val: "Map 1", ack: true });
        // Load button existence
        // V1MapService calls deps.ensureState("Devices.duid1.floors.0.load", ...)
        (0, vitest_1.expect)(depsMock.ensureState).toHaveBeenCalledWith("Devices.duid1.floors.0.load", vitest_1.expect.objectContaining({ role: "button" }));
    });
    (0, vitest_1.it)("should format get_clean_record_map parameters correctly based on protocol version", async () => {
        const vacuum = new TestVacuum(depsMock, "duid1", "roborock.vacuum.a70", { staticFeatures: [] });
        // Test B01 Protocol
        adapterMock.getDeviceProtocolVersion.mockResolvedValue("B01");
        requestsHandlerMock.sendRequest.mockResolvedValue(null);
        await vacuum.getCleaningRecordMap(1234567890);
        (0, vitest_1.expect)(requestsHandlerMock.sendRequest).toHaveBeenCalledWith("duid1", "get_clean_record_map", { start_time: 1234567890 }, vitest_1.expect.any(Object));
        // Test Standard Protocol (1.0)
        adapterMock.getDeviceProtocolVersion.mockResolvedValue("1.0");
        requestsHandlerMock.sendRequest.mockClear();
        await vacuum.getCleaningRecordMap(1234567890);
        (0, vitest_1.expect)(requestsHandlerMock.sendRequest).toHaveBeenCalledWith("duid1", "get_clean_record_map", { start_time: 1234567890 }, vitest_1.expect.any(Object));
    });
    (0, vitest_1.it)("should use set_clean_repeat_times for generated segment clean payloads", async () => {
        const vacuum = new TestVacuum(depsMock, "duid1", "roborock.vacuum.a144", { staticFeatures: [] });
        adapterMock.getStateAsync.mockImplementation(async (id) => {
            if (id === "Devices.duid1.commands.set_clean_repeat_times")
                return { val: 2 };
            return undefined;
        });
        adapterMock.getStatesAsync.mockResolvedValue({
            "roborock.0.Devices.duid1.floors.0.7": { val: true },
            "roborock.0.Devices.duid1.floors.0.8": { val: false },
            "roborock.0.Devices.duid1.floors.0.9": { val: 1 }
        });
        const params = await vacuum.getCommandParams("app_segment_clean");
        (0, vitest_1.expect)(params).toEqual([{
                segments: [7, 9],
                repeat: 2,
                clean_order_mode: 0,
                clean_mop: 0
            }]);
    });
    (0, vitest_1.it)("should use set_clean_repeat_times when explicit room ids are supplied", async () => {
        const vacuum = new TestVacuum(depsMock, "duid1", "roborock.vacuum.a144", { staticFeatures: [] });
        adapterMock.getStateAsync.mockResolvedValue({ val: "2" });
        const params = await vacuum.getCommandParams("app_segment_clean", [7]);
        (0, vitest_1.expect)(params).toEqual([{
                segments: [7],
                repeat: 2,
                clean_order_mode: 0,
                clean_mop: 0
            }]);
        (0, vitest_1.expect)(adapterMock.getStatesAsync).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=v1VacuumFeatures.test.js.map