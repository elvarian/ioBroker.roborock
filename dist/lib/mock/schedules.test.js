"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const v1VacuumFeatures_1 = require("../features/vacuum/v1VacuumFeatures");
const MockAdapter_1 = require("./MockAdapter");
const MockRobot_1 = require("./MockRobot");
class TestVacuum extends v1VacuumFeatures_1.V1VacuumFeatures {
    getDynamicFeatures() {
        return new Set();
    }
    async detectAndApplyRuntimeFeatures() {
        return false;
    }
}
(0, vitest_1.describe)("Schedule (Timer) Verification", () => {
    let mockAdapter;
    let mockRobot;
    let vacuumFeatures;
    let depsMock;
    (0, vitest_1.beforeEach)(async () => {
        mockAdapter = new MockAdapter_1.MockAdapter();
        mockRobot = new MockRobot_1.MockRobot();
        depsMock = {
            adapter: mockAdapter,
            log: mockAdapter.log,
            ensureState: async (id, common) => {
                await mockAdapter.setObjectNotExistsAsync(id, { type: "state", common });
            },
            ensureFolder: async (id) => {
                await mockAdapter.setObjectNotExistsAsync(id, { type: "folder", common: { name: id } });
            },
            config: { staticFeatures: [] },
            http_api: {
                getFwFeaturesResult: () => mockRobot.features,
                storeFwFeaturesResult: () => { },
                getRobotModel: () => mockRobot.model
            },
            requestsHandler: {
                sendRequest: async (duid, method, params) => {
                    if (duid !== mockRobot.duid)
                        return [];
                    return mockRobot.handleRequest(method, params);
                },
                command: async () => { }
            }
        };
        mockAdapter.requestsHandler = depsMock.requestsHandler;
        mockAdapter.http_api = depsMock.http_api;
        vacuumFeatures = new TestVacuum(depsMock, mockRobot.duid, mockRobot.model, { staticFeatures: [] });
        await vacuumFeatures.initialize();
    });
    (0, vitest_1.it)("should process timers and create schedule states", async () => {
        // Mock timer response
        const timerResponse = [
            ["timer_id_1", "on", ["0 14 * * 5", ["Start Cleaning", ["102", "1", "101", "100"]], 1234567890]],
            ["timer_id_2", "off", ["0 10 * * *", ["Start Cleaning", ["102", "1", "101", "100"]], 1234567891]],
            ["timer_id_3", "on", ["0 8 * * 1,3,5", ["Start Cleaning", ["102", "1", "101", "100"]], 1234567892]]
        ];
        // Inject mock into requestsHandler.sendRequest instead of mockRobot
        const originalSendRequest = depsMock.requestsHandler.sendRequest;
        depsMock.requestsHandler.sendRequest = vitest_1.vi.fn().mockImplementation(async (duid, method, params) => {
            if (method === "get_timer")
                return timerResponse;
            return originalSendRequest(duid, method, params);
        });
        // Call via vacuumFeatures
        await vacuumFeatures.updateTimers();
        // Check if get_timer was called
        (0, vitest_1.expect)(depsMock.requestsHandler.sendRequest).toHaveBeenCalledWith(vitest_1.expect.anything(), "get_timer", vitest_1.expect.anything());
        // Verify States are created
        const duid = mockRobot.duid;
        await mockAdapter.expectState(`Devices.${duid}.schedules.timer_id_1.enabled`, { val: true });
        await mockAdapter.expectState(`Devices.${duid}.schedules.timer_id_1.cron`, { val: "0 14 * * 5" });
        await mockAdapter.expectState(`Devices.${duid}.schedules.timer_id_2.enabled`, { val: false });
        await mockAdapter.expectState(`Devices.${duid}.schedules.timer_id_3.cron`, { val: "0 8 * * 1,3,5" });
    });
});
//# sourceMappingURL=schedules.test.js.map