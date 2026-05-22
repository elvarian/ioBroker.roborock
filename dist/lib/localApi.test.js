"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const localApi_1 = require("./localApi");
const messageParser_1 = require("./messageParser");
const MockAdapter_1 = require("./mock/MockAdapter");
const requestsHandler_1 = require("./requestsHandler");
(0, vitest_1.describe)("local_api transport sequence", () => {
    (0, vitest_1.it)("sends app-style TCP connect without consuming the app-frame sequence", async () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const parser = new messageParser_1.messageParser(adapter);
        const sentMessages = [];
        adapter.http_api = { getMatchedLocalKeys: () => new Map([[duid, "0011223344556677"]]) };
        adapter.local_api = api;
        adapter.requestsHandler = { messageParser: parser };
        api.sendMessage = (_duid, message) => {
            sentMessages.push(message);
            return true;
        };
        api.localDevices[duid] = {
            ip: "127.0.0.1",
            version: "L01",
            connectNonce: 123456,
            ackNonce: 654321,
        };
        parser.resetTransportSequence(duid);
        await api.sendHello(duid, 123456, "L01");
        const appFrame = await parser.buildRoborockMessage(duid, 4, Math.floor(Date.now() / 1000), JSON.stringify({ dps: { 101: JSON.stringify({ id: 301, method: "get_status", params: [] }) }, t: 1 }), "L01");
        (0, vitest_1.expect)(sentMessages).to.have.length(1);
        (0, vitest_1.expect)(sentMessages[0].readUInt32BE(0)).to.equal(21);
        (0, vitest_1.expect)(sentMessages[0].readUInt32BE(4 + 3)).to.equal(0);
        (0, vitest_1.expect)(sentMessages[0].readUInt32BE(4 + 17)).to.equal(10);
        (0, vitest_1.expect)(appFrame).to.be.instanceOf(Buffer);
        (0, vitest_1.expect)(appFrame.readUInt32BE(3)).to.equal(1);
    });
    (0, vitest_1.it)("sends app-style TCP ping and puback control frames", () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const sentMessages = [];
        api.sendMessage = (_duid, message) => {
            sentMessages.push(message);
            return true;
        };
        api.localDevices[duid] = {
            ip: "127.0.0.1",
            version: "1.0",
            ackNonce: 654321,
        };
        api.deviceSockets[duid] = {
            connected: true,
            pingOutstanding: 0,
        };
        api.sendPing(duid);
        api.sendPubAck(duid, 42, "1.0");
        (0, vitest_1.expect)(sentMessages).to.have.length(2);
        (0, vitest_1.expect)(sentMessages[0].readUInt32BE(0)).to.equal(17);
        (0, vitest_1.expect)(sentMessages[0].subarray(4, 7).toString()).to.equal("1.0");
        (0, vitest_1.expect)(sentMessages[0].readUInt32BE(4 + 3)).to.equal(0);
        (0, vitest_1.expect)(sentMessages[0].readUInt32BE(4 + 7)).to.equal(0);
        (0, vitest_1.expect)(sentMessages[0].readUInt32BE(4 + 11)).to.equal(0);
        (0, vitest_1.expect)(sentMessages[0].readUInt16BE(4 + 15)).to.equal(2);
        (0, vitest_1.expect)(sentMessages[1].readUInt32BE(0)).to.equal(17);
        (0, vitest_1.expect)(sentMessages[1].subarray(4, 7).toString()).to.equal("1.0");
        (0, vitest_1.expect)(sentMessages[1].readUInt32BE(4 + 3)).to.equal(42);
        (0, vitest_1.expect)(sentMessages[1].readUInt32BE(4 + 7)).to.equal(0);
        (0, vitest_1.expect)(sentMessages[1].readUInt32BE(4 + 11)).to.equal(0);
        (0, vitest_1.expect)(sentMessages[1].readUInt16BE(4 + 15)).to.equal(5);
        (0, vitest_1.expect)(api.deviceSockets[duid].pingOutstanding).to.equal(1);
    });
    (0, vitest_1.it)("sends app-style TCP ping only after inbound or outbound activity is idle", () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const sentMessages = [];
        const now = Date.now();
        api.sendMessage = (_duid, message) => {
            sentMessages.push(message);
            return true;
        };
        api.localDevices[duid] = {
            ip: "127.0.0.1",
            version: "1.0",
            ackNonce: 654321,
        };
        api.deviceSockets[duid] = {
            connected: true,
            lastReceivedAt: now,
            lastSentAt: now,
            pingOutstanding: 0,
        };
        api.checkTcpActivity(duid);
        (0, vitest_1.expect)(sentMessages).to.have.length(0);
        api.deviceSockets[duid].lastReceivedAt = now - 9_000;
        api.deviceSockets[duid].lastSentAt = now;
        api.checkTcpActivity(duid);
        (0, vitest_1.expect)(sentMessages).to.have.length(1);
        (0, vitest_1.expect)(sentMessages[0].readUInt16BE(4 + 15)).to.equal(2);
    });
    (0, vitest_1.it)("keeps an outstanding ping open until the ping response deadline", () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        let reconnects = 0;
        const sentMessages = [];
        const now = Date.now();
        api.sendMessage = (_duid, message) => {
            sentMessages.push(message);
            return true;
        };
        api.scheduleReconnect = () => {
            reconnects += 1;
        };
        api.localDevices[duid] = {
            ip: "127.0.0.1",
            version: "1.0",
            ackNonce: 654321,
        };
        api.deviceSockets[duid] = {
            connected: true,
            lastReceivedAt: now - 20_000,
            lastSentAt: now - 1_000,
            lastPingAt: now - 1_000,
            pingOutstanding: 1,
        };
        api.checkTcpActivity(duid);
        (0, vitest_1.expect)(reconnects).to.equal(0);
        (0, vitest_1.expect)(sentMessages).to.have.length(0);
        api.deviceSockets[duid].lastPingAt = now - 11_000;
        api.checkTcpActivity(duid);
        (0, vitest_1.expect)(reconnects).to.equal(1);
        (0, vitest_1.expect)(sentMessages).to.have.length(0);
    });
    (0, vitest_1.it)("does not send another TCP ping while a previous ping is outstanding", () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        let reconnects = 0;
        const sentMessages = [];
        const now = Date.now();
        api.sendMessage = (_duid, message) => {
            sentMessages.push(message);
            return true;
        };
        api.scheduleReconnect = () => {
            reconnects += 1;
        };
        api.localDevices[duid] = {
            ip: "127.0.0.1",
            version: "1.0",
            ackNonce: 654321,
        };
        api.deviceSockets[duid] = {
            connected: true,
            lastReceivedAt: now - 20_000,
            lastSentAt: now - 20_000,
            lastPingAt: now - 5_000,
            pingOutstanding: 1,
        };
        api.checkTcpActivity(duid);
        (0, vitest_1.expect)(reconnects).to.equal(0);
        (0, vitest_1.expect)(sentMessages).to.have.length(0);
    });
    (0, vitest_1.it)("rejects only pending TCP requests for the reset device", async () => {
        const adapter = new MockAdapter_1.MockAdapter();
        adapter.setInterval = () => undefined;
        const handler = new requestsHandler_1.requestsHandler(adapter);
        const api = new localApi_1.local_api(adapter);
        const tcpReq = new requestsHandler_1.RoborockRequest(handler, "duid-a", "get_prop", ["get_status"], {}, "TestQueue", "1.0");
        const mqttReq = new requestsHandler_1.RoborockRequest(handler, "duid-a", "get_prop", ["get_status"], {}, "TestQueue", "1.0");
        const otherTcpReq = new requestsHandler_1.RoborockRequest(handler, "duid-b", "get_prop", ["get_status"], {}, "TestQueue", "1.0");
        adapter.requestsHandler = handler;
        adapter.local_api = api;
        adapter.logLevel = "error";
        adapter.setTimeout = () => undefined;
        tcpReq.messageID = 1;
        tcpReq.sentConnectionType = "TCP";
        mqttReq.messageID = 2;
        mqttReq.sentConnectionType = "MQTT";
        otherTcpReq.messageID = 3;
        otherTcpReq.sentConnectionType = "TCP";
        adapter.pendingRequests.set(1, tcpReq);
        adapter.pendingRequests.set(2, mqttReq);
        adapter.pendingRequests.set(3, otherTcpReq);
        api.scheduleReconnect("duid-a", "connection error: read ECONNRESET", true);
        await (0, vitest_1.expect)(tcpReq.promise).rejects.toThrow(/TCP network session reset/);
        (0, vitest_1.expect)(adapter.pendingRequests.has(1)).to.equal(false);
        (0, vitest_1.expect)(adapter.pendingRequests.has(2)).to.equal(true);
        (0, vitest_1.expect)(adapter.pendingRequests.has(3)).to.equal(true);
    });
    (0, vitest_1.it)("resolves local protocol 4 responses from dps 102, dps 101, or direct payloads", () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const resolved = [];
        adapter.requestsHandler = {
            resolvePendingRequest: (id, result, protocol, _duid, connectionType) => {
                resolved.push({ id, result, protocol, connectionType });
            },
        };
        api.resolveLocalProtocol4Payload(duid, "1.0", 4, { dps: { "102": { id: 301, result: ["ok"] } } });
        api.resolveLocalProtocol4Payload(duid, "1.0", 4, { dps: { "101": JSON.stringify({ id: 302, result: ["done"] }) } });
        api.resolveLocalProtocol4Payload(duid, "1.0", 4, { id: 303, error: { code: -1 } });
        (0, vitest_1.expect)(resolved).to.deep.equal([
            { id: 301, result: ["ok"], protocol: "4", connectionType: "TCP" },
            { id: 302, result: ["done"], protocol: "4", connectionType: "TCP" },
            { id: 303, result: { code: -1 }, protocol: "4", connectionType: "TCP" },
        ]);
    });
    (0, vitest_1.it)("does not treat trailing partial TCP frame bytes as complete", () => {
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const frame = Buffer.alloc(4 + 17);
        frame.writeUInt32BE(17, 0);
        frame.write("1.0", 4);
        frame.writeUInt16BE(3, 4 + 15);
        (0, vitest_1.expect)(api.checkComplete(frame)).to.equal(true);
        (0, vitest_1.expect)(api.checkComplete(frame.subarray(0, frame.length - 1))).to.equal(false);
        (0, vitest_1.expect)(api.checkComplete(Buffer.concat([frame, Buffer.from([0x00, 0x00])]))).to.equal(false);
        (0, vitest_1.expect)(api.checkComplete(Buffer.from([0x00, 0x00, 0x11]))).to.equal(false);
    });
    (0, vitest_1.it)("merges discovered endpoint changes without dropping other local devices", () => {
        const duid = "duid-a";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const attempts = [];
        let destroyed = false;
        adapter.requestsHandler = {
            rejectPendingTcpRequests: () => 0,
        };
        api.initiateClient = async (attemptDuid, suppressLog, timeoutMs) => {
            attempts.push({ duid: attemptDuid, suppressLog: !!suppressLog, timeoutMs });
        };
        api.localDevices[duid] = {
            ip: "10.1.1.81",
            version: "1.0",
            connectNonce: 1,
            ackNonce: 2,
            staleSince: 100,
        };
        api.localDevices["duid-b"] = {
            ip: "10.1.1.82",
            version: "1.0",
        };
        api.deviceSockets[duid] = {
            connected: true,
            destroyed: false,
            removeAllListeners: () => { },
            destroy: () => {
                destroyed = true;
            },
        };
        const changed = api.updateLocalEndpoint(duid, "10.1.1.89", "1.0", "udp");
        (0, vitest_1.expect)(changed).to.equal(true);
        (0, vitest_1.expect)(api.localDevices[duid].ip).to.equal("10.1.1.89");
        (0, vitest_1.expect)(api.localDevices[duid].connectNonce).to.equal(undefined);
        (0, vitest_1.expect)(api.localDevices[duid].ackNonce).to.equal(undefined);
        (0, vitest_1.expect)(api.localDevices[duid].staleSince).to.equal(undefined);
        (0, vitest_1.expect)(api.localDevices["duid-b"].ip).to.equal("10.1.1.82");
        (0, vitest_1.expect)(api.deviceSockets[duid]).to.equal(undefined);
        (0, vitest_1.expect)(destroyed).to.equal(true);
        (0, vitest_1.expect)(attempts).to.deep.equal([{ duid, suppressLog: true, timeoutMs: 5000 }]);
    });
    (0, vitest_1.it)("marks unreachable TCP endpoints stale and triggers endpoint refresh instead of reconnect looping", async () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        let scheduledReconnects = 0;
        let refreshes = 0;
        adapter.requestsHandler = {
            rejectPendingTcpRequests: () => 0,
        };
        api.localDevices[duid] = {
            ip: "10.1.1.81",
            version: "1.0",
        };
        api._performConnection = async () => {
            const err = new Error("connect EHOSTUNREACH 10.1.1.81:58867");
            err.code = "EHOSTUNREACH";
            throw err;
        };
        api.scheduleReconnect = () => {
            scheduledReconnects += 1;
        };
        api.refreshEndpoint = async () => {
            refreshes += 1;
            return false;
        };
        await api.initiateClient(duid);
        (0, vitest_1.expect)(scheduledReconnects).to.equal(0);
        (0, vitest_1.expect)(refreshes).to.equal(1);
        (0, vitest_1.expect)(api.localDevices[duid].staleSince).to.be.a("number");
    });
    (0, vitest_1.it)("clears stale endpoint state after a confirmed local TCP connection", async () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        api.cloudDevices.add(duid);
        api.localDevices[duid] = {
            ip: "10.1.1.81",
            version: "B01",
            staleSince: 100,
        };
        api.deviceSockets[duid] = {
            connected: true,
        };
        await api.initiateClient(duid);
        (0, vitest_1.expect)(api.localDevices[duid].staleSince).to.equal(undefined);
        (0, vitest_1.expect)(api.localDevices[duid].lastSeenAt).to.be.a("number");
        (0, vitest_1.expect)(api.cloudDevices.has(duid)).to.equal(false);
    });
    (0, vitest_1.it)("refreshes stale endpoints from MQTT network info and reconnects to the new IP", async () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const requests = [];
        const attempts = [];
        adapter.mqtt_api = { isConnected: () => true };
        adapter.requestsHandler = {
            sendRequest: async (_duid, method, params) => {
                requests.push({ method, params });
                return [{ ip: "10.1.1.89" }];
            },
            rejectPendingTcpRequests: () => 0,
        };
        adapter.getDeviceProtocolVersion = async () => "1.0";
        api.initiateClient = async (attemptDuid) => {
            attempts.push(attemptDuid);
        };
        api.localDevices[duid] = {
            ip: "10.1.1.81",
            version: "1.0",
            staleSince: 100,
        };
        await (0, vitest_1.expect)(api.refreshEndpoint(duid, "test", true)).resolves.to.equal(true);
        (0, vitest_1.expect)(requests).to.deep.equal([{ method: "get_network_info", params: [] }]);
        (0, vitest_1.expect)(api.localDevices[duid].ip).to.equal("10.1.1.89");
        (0, vitest_1.expect)(api.localDevices[duid].staleSince).to.equal(undefined);
        (0, vitest_1.expect)(attempts).to.deep.equal([duid]);
    });
    (0, vitest_1.it)("uses B01 network info method and accepts ipAdress spelling during endpoint refresh", async () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const requests = [];
        adapter.mqtt_api = { isConnected: () => true };
        adapter.requestsHandler = {
            sendRequest: async (_duid, method, params) => {
                requests.push({ method, params });
                return { ipAdress: "10.1.1.90" };
            },
            rejectPendingTcpRequests: () => 0,
        };
        adapter.getDeviceProtocolVersion = async () => "B01";
        api.initiateClient = async () => { };
        api.localDevices[duid] = {
            ip: "10.1.1.81",
            version: "B01",
            staleSince: 100,
        };
        await (0, vitest_1.expect)(api.refreshEndpoint(duid, "test", true)).resolves.to.equal(true);
        (0, vitest_1.expect)(requests).to.deep.equal([{ method: "service.get_net_info", params: {} }]);
        (0, vitest_1.expect)(api.localDevices[duid].ip).to.equal("10.1.1.90");
    });
    (0, vitest_1.it)("does not throttle the next endpoint refresh after MQTT was temporarily unavailable", async () => {
        const duid = "duid";
        const adapter = new MockAdapter_1.MockAdapter();
        const api = new localApi_1.local_api(adapter);
        const requests = [];
        let mqttConnected = false;
        adapter.mqtt_api = { isConnected: () => mqttConnected };
        adapter.requestsHandler = {
            sendRequest: async (_duid, method) => {
                requests.push(method);
                return [{ ip: "10.1.1.91" }];
            },
            rejectPendingTcpRequests: () => 0,
        };
        adapter.getDeviceProtocolVersion = async () => "1.0";
        api.initiateClient = async () => { };
        api.localDevices[duid] = {
            ip: "10.1.1.81",
            version: "1.0",
            staleSince: 100,
        };
        await (0, vitest_1.expect)(api.refreshEndpoint(duid, "mqtt down", false)).resolves.to.equal(false);
        mqttConnected = true;
        await (0, vitest_1.expect)(api.refreshEndpoint(duid, "mqtt back", false)).resolves.to.equal(true);
        (0, vitest_1.expect)(requests).to.deep.equal(["get_network_info"]);
        (0, vitest_1.expect)(api.localDevices[duid].ip).to.equal("10.1.1.91");
    });
});
//# sourceMappingURL=localApi.test.js.map