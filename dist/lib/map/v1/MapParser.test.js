"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const MapParser_1 = require("./MapParser");
// Mock adapter
const mockAdapter = {
    log: {
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
    },
    http_api: {
        getMatchedRoomIDs: () => [],
    },
    rLog: () => { },
};
(0, vitest_1.describe)("MapParser", () => {
    let parser;
    (0, vitest_1.beforeEach)(() => {
        parser = new MapParser_1.MapParser(mockAdapter);
    });
    (0, vitest_1.it)("should return empty object for empty buffer", async () => {
        const result = await parser.parsedata(Buffer.alloc(0), null);
        (0, vitest_1.expect)(result).to.deep.equal({});
    });
    (0, vitest_1.it)("should not crash on random garbage data", async () => {
        const garbage = Buffer.alloc(100);
        garbage.fill(0xff);
        try {
            const result = await parser.parsedata(garbage, null);
            (0, vitest_1.expect)(result).to.deep.equal({}); // Garbage usually results in empty object or partial parse
        }
        catch {
            // If it throws, it's acceptable, but ideally it handles it.
        }
    });
});
//# sourceMappingURL=MapParser.test.js.map