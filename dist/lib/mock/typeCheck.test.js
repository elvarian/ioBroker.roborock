"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const features_enum_1 = require("../features/features.enum");
const v1VacuumFeatures_1 = require("../features/vacuum/v1VacuumFeatures");
const MockAdapter_1 = require("./MockAdapter");
const MockRobot_1 = require("./MockRobot");
// Concrete implementation for testing abstract class
class TestVacuum extends v1VacuumFeatures_1.V1VacuumFeatures {
    getDynamicFeatures() {
        return new Set();
    }
    async detectAndApplyRuntimeFeatures() {
        return false;
    }
}
(0, vitest_1.describe)("Adapter Type Verification", () => {
    let mockAdapter;
    let mockRobot;
    let vacuumFeatures;
    let depsMock;
    (0, vitest_1.beforeEach)(async () => {
        mockAdapter = new MockAdapter_1.MockAdapter();
        mockRobot = new MockRobot_1.MockRobot();
        // Mock the Dependencies
        depsMock = {
            adapter: mockAdapter,
            log: mockAdapter.log,
            ensureState: async (id, common) => {
                // BaseDeviceFeatures.ensureState passes 'native' as 3rd arg, NOT value.
                // So we only ensure object existence here.
                await mockAdapter.setObjectNotExistsAsync(id, { type: "state", common });
            },
            ensureFolder: async (id) => {
                await mockAdapter.setObjectNotExistsAsync(id, { type: "folder", common: { name: id } });
            },
            config: { staticFeatures: [] },
            http_api: {
                getFwFeaturesResult: () => mockRobot.features,
                storeFwFeaturesResult: () => { }
            },
            // Intercept all requests and route to MockRobot
            requestsHandler: {
                sendRequest: async (duid, method, params) => {
                    if (duid !== mockRobot.duid)
                        return [];
                    return mockRobot.handleRequest(method, params);
                },
                command: async () => { } // Add dummy command handler
            }
        };
        depsMock.adapter.translationManager = { get: (key, def) => def || key };
        // Attach requestsHandler to mockAdapter as BaseDeviceFeatures expects it there
        mockAdapter.requestsHandler = depsMock.requestsHandler;
        // Instantiate the vacuum features handler for our mock device
        // We use the A147 model from the log
        vacuumFeatures = new TestVacuum(depsMock, mockRobot.duid, mockRobot.model, { staticFeatures: [features_enum_1.Feature.NetworkInfo, features_enum_1.Feature.CleaningInfo] });
    });
    (0, vitest_1.it)("should process get_status and update states with correct types", async () => {
        await vacuumFeatures.initialize();
        await vacuumFeatures.updateStatus();
        // updateStatus handles 'deviceStatus' states.
        // Verify one of them, e.g. battery or fan_power
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.deviceStatus.battery`]).to.equal(100);
    });
    (0, vitest_1.it)("should process network info and verify types", async () => {
        await vacuumFeatures.initialize();
        await vacuumFeatures.updateNetworkInfo();
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.networkInfo.ip`]).to.equal("192.168.1.91");
    });
    (0, vitest_1.it)("should process clean summary and verify types", async () => {
        await vacuumFeatures.initialize();
        await vacuumFeatures.updateCleanSummary();
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.clean_time`]).to.equal(123);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.clean_count`]).to.equal(190);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.records.0.startTime`]).to.equal(1765198801);
        (0, vitest_1.expect)(JSON.parse(String(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.JSON`]))[0]).toMatchObject({
            begin: 1765198801,
            duration: 4538,
            area: 51290000
        });
    });
    (0, vitest_1.it)("should process positional V1 clean summary and clean record arrays", async () => {
        const originalSendRequest = depsMock.requestsHandler.sendRequest;
        depsMock.requestsHandler.sendRequest = async (duid, method, params) => {
            if (duid !== mockRobot.duid)
                return [];
            if (method === "get_clean_summary") {
                return [4373837, 76997095000, 2626, [1774980747, 1774980736, 1774980728]];
            }
            if (method === "get_clean_record") {
                const startTime = Number(params[0]);
                return [[startTime, startTime + 300, 300, 6165000, 0, 1, 2, 3, 56]];
            }
            return originalSendRequest(duid, method, params);
        };
        await vacuumFeatures.initialize();
        await vacuumFeatures.updateCleanSummary();
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.clean_time`]).to.equal(1215);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.clean_area`]).to.equal(76997);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.clean_count`]).to.equal(2626);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.records.0.startTime`]).to.equal(1774980747);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.records.0.duration`]).to.equal(5);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.records.0.area`]).to.equal(6);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.records.0.field_8`]).to.equal(56);
        (0, vitest_1.expect)(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.records.0.0`]).to.be.undefined;
        (0, vitest_1.expect)(JSON.parse(String(mockAdapter.states[`Devices.${mockRobot.duid}.cleaningInfo.JSON`]))[0]).toEqual([
            1774980747,
            1774981047,
            300,
            6165000,
            0,
            1,
            2,
            3,
            56
        ]);
    });
});
//# sourceMappingURL=typeCheck.test.js.map