"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const RoborockNodeClient_1 = require("./RoborockNodeClient");
function payloadCommand(msg, configuredAction) {
    return String(configuredAction || msg.action || msg.command || msg.topic || "status").toLowerCase();
}
function payloadDuid(msg, configuredDuid) {
    return String(configuredDuid || msg.duid || msg.device || msg.deviceId || "");
}
module.exports = function registerRoborockNodes(RED) {
    class RoborockConfig {
        id;
        credentials;
        client;
        constructor(config) {
            RED.nodes.createNode(this, config);
            const node = this;
            const options = {
                username: String(node.credentials?.username || ""),
                password: node.credentials?.password || "",
                region: String(config.region || "eu"),
                loginMethod: String(config.loginMethod || "password"),
                logger: {
                    debug: (message) => node.debug(message),
                    info: (message) => node.log(message),
                    warn: (message) => node.warn(message),
                    error: (message) => node.error(message),
                },
            };
            this.client = new RoborockNodeClient_1.RoborockNodeClient(options);
            node.getClient = async () => {
                await this.client.connect();
                return this.client;
            };
            node.closeClient = (done) => {
                this.client.close()
                    .catch((error) => node.error(error instanceof Error ? error : String(error)))
                    .finally(() => done?.());
            };
            node.on("close", (_removed, done) => node.closeClient(done));
        }
    }
    class RoborockCommandNode {
        constructor(config) {
            RED.nodes.createNode(this, config);
            const node = this;
            const connection = RED.nodes.getNode(String(config.connection || ""));
            const configuredAction = String(config.action || "");
            const configuredDuid = String(config.duid || "");
            node.on("input", async (msg, send, done) => {
                const nodeSend = send || ((out) => node.send(out));
                if (!connection) {
                    const error = new Error("Roborock connection is not configured");
                    node.status({ fill: "red", shape: "ring", text: "not configured" });
                    done ? done(error) : node.error(error, msg);
                    return;
                }
                const action = payloadCommand(msg, configuredAction);
                const duid = payloadDuid(msg, configuredDuid);
                const params = action === "raw" ? msg.payload : msg.payload;
                try {
                    if (action === "login-code") {
                        const code = String(msg.payload?.code || msg.payload || "");
                        const result = connection.client.http_api.submitLoginCode(code);
                        if (!result.accepted) {
                            throw new Error("Login code must be a 6-digit code");
                        }
                        msg.payload = { ok: true, delivered: result.delivered, queued: !result.delivered };
                        node.status({ fill: "green", shape: "dot", text: result.delivered ? "code sent" : "code queued" });
                        nodeSend(msg);
                        done?.();
                        return;
                    }
                    node.status({ fill: "yellow", shape: "dot", text: action });
                    const client = await connection.getClient();
                    const result = await client.execute(action, duid, params);
                    msg.payload = result;
                    msg.roborock = { action, duid };
                    node.status({ fill: "green", shape: "dot", text: "ok" });
                    nodeSend(msg);
                    done?.();
                }
                catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    node.status({ fill: "red", shape: "ring", text: err.message });
                    done ? done(err) : node.error(err, msg);
                }
            });
        }
    }
    RED.nodes.registerType("roborock-config", RoborockConfig, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" },
        },
    });
    RED.nodes.registerType("roborock", RoborockCommandNode);
};
//# sourceMappingURL=roborock.js.map