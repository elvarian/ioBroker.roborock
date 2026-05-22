"use strict";
// test/messageParser.test.ts
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const messageParser_1 = require("./messageParser");
// Mocking the Roborock adapter structure
const mockAdapter = {
    log: {
        error: console.error,
        info: console.log,
        debug: () => { }, // Silence debug logs in tests
    },
    http_api: {
        // Returns a Map mimicking the local keys store
        getMatchedLocalKeys: () => new Map([["test-duid", "0011223344556677"]]),
    },
    local_api: {
        localDevices: {
            "test-duid": {
                connectNonce: Buffer.alloc(16),
                ackNonce: Buffer.alloc(16),
            },
        },
    },
    mqtt_api: {
        ensureEndpoint: async () => "mqtt://localhost",
    },
    getDeviceProtocolVersion: async () => "1.0",
    nonce: Buffer.from("abcdef", "hex"),
};
(0, vitest_1.describe)("messageParser", () => {
    const parser = new messageParser_1.messageParser(mockAdapter);
    (0, vitest_1.it)("should build and decode a simple message (Protocol 1.0)", async () => {
        const payload = JSON.stringify({ id: 1, method: "get_status", params: [] });
        const timestamp = Math.floor(Date.now() / 1000);
        const msg = await parser.buildRoborockMessage("test-duid", 1000, timestamp, payload, "1.0");
        // Ensure message creation was successful
        (0, vitest_1.expect)(msg).to.not.be.false;
        (0, vitest_1.expect)(msg).to.be.instanceOf(Buffer);
        // Decode the generated message
        const decoded = parser.decodeMsg(msg, "test-duid");
        (0, vitest_1.expect)(decoded).to.be.an("array");
        (0, vitest_1.expect)(decoded.length).to.equal(1);
        (0, vitest_1.expect)(decoded[0].version).to.equal("1.0");
        (0, vitest_1.expect)(decoded[0].protocol).to.equal(1000);
        // Optional: Verify payload content matches
        const decodedPayload = JSON.parse(decoded[0].payload.toString());
        (0, vitest_1.expect)(decodedPayload.method).to.equal("get_status");
    });
    (0, vitest_1.it)("should build L01 TCP payloads with dps.101 inside protocol 4 frames", async () => {
        const payload = await parser.buildPayload(4, 1806, "get_prop", ["get_status"], "L01");
        const decodedPayload = JSON.parse(payload);
        (0, vitest_1.expect)(decodedPayload.dps["101"]).to.be.a("string");
        (0, vitest_1.expect)(decodedPayload.dps["4"]).to.be.undefined;
        const inner = JSON.parse(decodedPayload.dps["101"]);
        (0, vitest_1.expect)(inner).to.deep.equal({
            id: 1806,
            method: "get_prop",
            params: ["get_status"],
        });
    });
    (0, vitest_1.it)("should build protocol 1.0 TCP payloads with dps.101 inside protocol 4 frames", async () => {
        const payload = await parser.buildPayload(4, 1806, "get_prop", ["get_status"], "1.0");
        const decodedPayload = JSON.parse(payload);
        (0, vitest_1.expect)(decodedPayload.dps["101"]).to.be.a("string");
        (0, vitest_1.expect)(decodedPayload.dps["4"]).to.be.undefined;
    });
    (0, vitest_1.it)("tracks transport sequence per device and wraps without using zero", () => {
        const localParser = new messageParser_1.messageParser(mockAdapter);
        localParser.resetTransportSequence("test-duid", 0xffff);
        (0, vitest_1.expect)(localParser.nextTransportSequenceId("test-duid")).to.equal(0xffff);
        (0, vitest_1.expect)(localParser.nextTransportSequenceId("test-duid")).to.equal(1);
        localParser.resetTransportSequence("other-duid");
        (0, vitest_1.expect)(localParser.nextTransportSequenceId("other-duid")).to.equal(1);
        (0, vitest_1.expect)(localParser.nextTransportSequenceId("test-duid")).to.equal(2);
    });
});
//# sourceMappingURL=messageParser.test.js.map