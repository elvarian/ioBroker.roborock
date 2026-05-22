"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const roomColoring_1 = require("./roomColoring");
(0, vitest_1.describe)("roomColoring", () => {
    const options = {
        oneBased: true, // Roborock usually starts IDs at 1
    };
    (0, vitest_1.it)("should assign different colors to neighbors", () => {
        // Scenario: [1] -- [2] -- [3]
        const maxBlockNum = 32;
        const neighborInfo = new Array(maxBlockNum * maxBlockNum).fill(0);
        const pointsCount = new Array(maxBlockNum).fill(0);
        // Setup Neighbors
        const setNeighbor = (a, b) => {
            neighborInfo[a * maxBlockNum + b] = 1;
            neighborInfo[b * maxBlockNum + a] = 1;
            // Also set self-neighbor to mark as valid room (as per new logic)
            neighborInfo[a * maxBlockNum + a] = 1;
            neighborInfo[b * maxBlockNum + b] = 1;
        };
        setNeighbor(1, 2);
        setNeighbor(2, 3);
        pointsCount[1] = 100;
        pointsCount[2] = 100;
        pointsCount[3] = 100;
        const data = { maxBlockNum, neighborInfo, pointsCount };
        const result = (0, roomColoring_1.assignRoborockRoomColorsToHex)(data, options);
        const c1 = result.colorBucket[1];
        const c2 = result.colorBucket[2];
        const c3 = result.colorBucket[3];
        (0, vitest_1.expect)(c1).to.not.equal(0);
        (0, vitest_1.expect)(c2).to.not.equal(0);
        (0, vitest_1.expect)(c3).to.not.equal(0);
        (0, vitest_1.expect)(c1).to.not.equal(c2, "Neighbors 1 and 2 must differ");
        (0, vitest_1.expect)(c2).to.not.equal(c3, "Neighbors 2 and 3 must differ");
    });
    (0, vitest_1.it)("should use the default background color for unused rooms", () => {
        const maxBlockNum = 32;
        const neighborInfo = new Array(maxBlockNum * maxBlockNum).fill(0);
        const pointsCount = new Array(maxBlockNum).fill(0);
        const data = { maxBlockNum, neighborInfo, pointsCount };
        const result = (0, roomColoring_1.assignRoborockRoomColorsToHex)(data, options);
        // Unused room 5 should be the background color (Index 0)
        const hex = result.getColor(5, "light_highlight");
        const palette = (0, roomColoring_1.getPalette)("light_highlight");
        (0, vitest_1.expect)(hex).to.equal(palette[0]);
    });
});
//# sourceMappingURL=roomColoring.test.js.map