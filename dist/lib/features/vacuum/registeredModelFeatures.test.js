"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const baseDeviceFeatures_1 = require("../baseDeviceFeatures");
const features_enum_1 = require("../features.enum");
require("./index");
(0, vitest_1.describe)("registered vacuum model features", () => {
    function createHarness() {
        const requestsHandlerMock = {
            sendRequest: vitest_1.vi.fn().mockResolvedValue({}),
            command: vitest_1.vi.fn().mockResolvedValue(undefined),
            mapParser: { parsedata: vitest_1.vi.fn().mockResolvedValue({}) },
            mapCreator: { canvasMap: vitest_1.vi.fn().mockResolvedValue(["", "", ""]) }
        };
        const adapterMock = {
            namespace: "roborock.0",
            log: { info: vitest_1.vi.fn(), error: vitest_1.vi.fn(), warn: vitest_1.vi.fn(), debug: vitest_1.vi.fn(), silly: vitest_1.vi.fn() },
            setStateChanged: vitest_1.vi.fn().mockResolvedValue(undefined),
            setState: vitest_1.vi.fn(),
            ensureState: vitest_1.vi.fn().mockResolvedValue(undefined),
            ensureFolder: vitest_1.vi.fn().mockResolvedValue(undefined),
            getStateAsync: vitest_1.vi.fn().mockResolvedValue(undefined),
            getStatesAsync: vitest_1.vi.fn().mockResolvedValue({}),
            getObjectAsync: vitest_1.vi.fn().mockResolvedValue(undefined),
            extendObject: vitest_1.vi.fn().mockResolvedValue(undefined),
            setObject: vitest_1.vi.fn().mockResolvedValue(undefined),
            setObjectNotExistsAsync: vitest_1.vi.fn().mockResolvedValue(undefined),
            requestsHandler: requestsHandlerMock,
            getDeviceProtocolVersion: vitest_1.vi.fn().mockResolvedValue("1.0"),
            translations: {},
            http_api: {
                getFwFeaturesResult: vitest_1.vi.fn(),
                storeFwFeaturesResult: vitest_1.vi.fn(),
                getRobotModel: vitest_1.vi.fn().mockReturnValue("roborock.vacuum.a87"),
                getDevices: vitest_1.vi.fn().mockReturnValue([])
            },
            rLog: vitest_1.vi.fn(),
            translationManager: {
                get: vitest_1.vi.fn().mockImplementation((key, def) => def || key)
            },
            errorMessage: (error) => error instanceof Error ? error.message : String(error)
        };
        const dependencies = {
            adapter: adapterMock,
            http_api: adapterMock.http_api,
            ensureState: vitest_1.vi.fn().mockResolvedValue(undefined),
            ensureFolder: vitest_1.vi.fn().mockResolvedValue(undefined),
            log: adapterMock.log,
            config: { staticFeatures: [] }
        };
        return { adapterMock, dependencies };
    }
    (0, vitest_1.it)("exposes the verified Qrevo MaxV dust collection command through the model registry", async () => {
        const ModelClass = baseDeviceFeatures_1.BaseDeviceFeatures.getRegisteredModelClass("roborock.vacuum.a87");
        (0, vitest_1.expect)(ModelClass).toBeDefined();
        if (!ModelClass)
            throw new Error("roborock.vacuum.a87 is not registered");
        const { dependencies } = createHarness();
        const vacuum = new ModelClass(dependencies, "duid1");
        await vacuum.initialize();
        (0, vitest_1.expect)(vacuum.hasStaticFeature(features_enum_1.Feature.AutoEmptyDock)).toBe(true);
        (0, vitest_1.expect)(vacuum.commands).toHaveProperty("app_start_collect_dust");
        (0, vitest_1.expect)(vacuum.commands).not.toHaveProperty("app_start_dust_collection");
        await (0, vitest_1.expect)(vacuum.getCommandParams("app_start_collect_dust")).resolves.toEqual([]);
    });
});
//# sourceMappingURL=registeredModelFeatures.test.js.map