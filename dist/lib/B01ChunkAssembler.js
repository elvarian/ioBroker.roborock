"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.B01ChunkAssembler = void 0;
const MapDecryptor_1 = require("./map/b01/MapDecryptor");
const IS_PHOTO_MAGIC = "ROBOROCK";
const MAP_PAYLOAD_MIN = 500;
class B01ChunkAssembler {
    adapter;
    mapChunkBuffer = new Map();
    chunkTimeouts = new Map();
    static CHUNK_WAIT_TIMEOUT_MS = 10000;
    constructor(adapter) {
        this.adapter = adapter;
    }
    /** True if decrypted payload is a photo (starts with ROBOROCK). */
    static isPhotoChunk(decryptedPayload) {
        return decryptedPayload.length >= 8 && decryptedPayload.subarray(0, 8).toString("ascii") === IS_PHOTO_MAGIC;
    }
    /** True if frame is a map chunk (protocol 300/301, payload > 500). */
    static isMapFrame(protocol, payloadLen) {
        return (protocol === 300 || protocol === 301) && payloadLen > MAP_PAYLOAD_MIN;
    }
    /**
     * Processes a 300/301 packet. data.payload is already decrypted by messageParser (Layer1 output).
     * data.protocol = type, data.seq = chunkIndex.
     */
    async process(duid, data) {
        const payload = data.payload;
        const protocol = data.protocol;
        const chunkIndex = data.seq;
        const payloadLen = data.payloadLen ?? payload.length;
        if (!B01ChunkAssembler.isMapFrame(protocol, payloadLen)) {
            return { type: "skip" };
        }
        if (B01ChunkAssembler.isPhotoChunk(payload)) {
            return { type: "photo", payload };
        }
        // Map: type 300 = Chunk 1, type 301 + chunkIndex 2 = Chunk 2
        const isChunk1 = protocol === 300;
        const isChunk2 = protocol === 301 && chunkIndex === 2;
        if (isChunk1 || isChunk2) {
            const buf = this.mapChunkBuffer.get(duid) ?? [];
            buf.push({ layer1: Buffer.from(payload), type: protocol, chunkIndex });
            buf.sort((a, b) => a.chunkIndex - b.chunkIndex);
            this.mapChunkBuffer.set(duid, buf);
            if (buf.length < 2) {
                this.scheduleChunkTimeout(duid);
                return { type: "map_chunk_buffered" };
            }
            const chunk1 = buf.find((c) => c.type === 300);
            const chunk2 = buf.find((c) => c.type === 301 && c.chunkIndex === 2);
            if (!chunk1 || !chunk2) {
                this.scheduleChunkTimeout(duid);
                return { type: "map_chunk_buffered" };
            }
            this.clearChunkTimeout(duid);
            this.mapChunkBuffer.delete(duid);
            const layer1Concat = Buffer.concat([chunk1.layer1, chunk2.layer1]);
            const decrypted = await this.decryptChunkedMap(duid, layer1Concat);
            if (decrypted) {
                return { type: "map", payload: decrypted };
            }
            return { type: "map_incomplete", reason: "decryptFromLayer2 failed" };
        }
        // type 301 + chunkIndex 1 = single map (not chunked)
        if (protocol === 301 && chunkIndex === 1) {
            const decrypted = await this.decryptSingleMap(duid, payload);
            if (decrypted) {
                return { type: "map", payload: decrypted };
            }
        }
        return { type: "skip" };
    }
    /** Chunk 2 without Chunk 1 – whether we should drop it. */
    shouldDropIncompleteChunk2(rawFrame) {
        const r = B01ChunkAssembler.checkMapCompleteness(rawFrame);
        return !r.complete && r.missing === "Chunk 1 (300)";
    }
    /** Clears buffered chunks for duid (e.g. on timeout). */
    clearBuffer(duid) {
        this.clearChunkTimeout(duid);
        this.mapChunkBuffer.delete(duid);
    }
    scheduleChunkTimeout(duid) {
        this.clearChunkTimeout(duid);
        const timeout = this.adapter.setTimeout(() => {
            const buf = this.mapChunkBuffer.get(duid) ?? [];
            const hasChunk1 = buf.some((c) => c.type === 300);
            const hasChunk2 = buf.some((c) => c.type === 301 && c.chunkIndex === 2);
            if (!hasChunk1 || !hasChunk2) {
                const missing = !hasChunk1 ? "Chunk 1 (type 300)" : "Chunk 2 (type 301, seq=2)";
                const seen = buf.map((c) => `${c.type}/${c.chunkIndex}`).join(", ") || "none";
                this.adapter.rLog("MQTT", duid, "Warn", "B01", "301", `Chunk timeout after ${B01ChunkAssembler.CHUNK_WAIT_TIMEOUT_MS}ms: missing ${missing}. Seen=${seen}`, "warn");
            }
            this.chunkTimeouts.delete(duid);
            this.mapChunkBuffer.delete(duid);
        }, B01ChunkAssembler.CHUNK_WAIT_TIMEOUT_MS);
        this.chunkTimeouts.set(duid, timeout);
    }
    clearChunkTimeout(duid) {
        const existing = this.chunkTimeouts.get(duid);
        if (existing) {
            this.adapter.clearTimeout(existing);
            this.chunkTimeouts.delete(duid);
        }
    }
    getB01DecryptParams(duid) {
        const devices = this.adapter.http_api.getDevices();
        const device = devices.find((d) => d.duid === duid);
        const serial = device?.sn || "";
        const model = this.adapter.http_api.getRobotModel(duid) || "roborock.vacuum.a27";
        const localKey = this.adapter.http_api.getMatchedLocalKeys().get(duid);
        return { serial, model, localKey };
    }
    async decryptChunkedMap(duid, layer1Concat) {
        const { serial, model, localKey } = this.getB01DecryptParams(duid);
        const result = MapDecryptor_1.MapDecryptor.decryptFromLayer2(layer1Concat, serial, model, duid, this.adapter, localKey);
        return result && MapDecryptor_1.MapDecryptor.isSupportedB01MapPayload(result) ? result : null;
    }
    async decryptSingleMap(duid, payload) {
        const { serial, model, localKey } = this.getB01DecryptParams(duid);
        const result = MapDecryptor_1.MapDecryptor.decrypt(payload, serial, model, duid, this.adapter, localKey);
        return result && MapDecryptor_1.MapDecryptor.isSupportedB01MapPayload(result) ? result : null;
    }
    static checkMapCompleteness(buf) {
        if (buf.length < 19 || buf.toString("ascii", 0, 3) !== "B01") {
            return { complete: false, reason: "Not a B01 frame" };
        }
        const type = buf.readUInt16BE(15);
        const chunkIndex = buf.readUInt32BE(3);
        const payloadLen = buf.readUInt16BE(17);
        if (type !== 300 && type !== 301) {
            return { complete: false, reason: `Type ${type} is not map (300/301)` };
        }
        if (payloadLen <= 500) {
            return { complete: false, reason: `Payload ${payloadLen} B too small for map` };
        }
        if (type === 300) {
            return {
                complete: false,
                reason: "Chunk 1 (type=300) – needs Chunk 2 (301)",
                type,
                chunkIndex,
                payloadLen,
                missing: "Chunk 2 (301)",
            };
        }
        if (chunkIndex === 2) {
            return {
                complete: false,
                reason: "Chunk 2 (chunkIndex=2) – needs Chunk 1 (300)",
                type,
                chunkIndex,
                payloadLen,
                missing: "Chunk 1 (300)",
            };
        }
        return {
            complete: true,
            reason: `Single map (type=301, chunkIndex=1, payloadLen=${payloadLen})`,
            type,
            chunkIndex,
            payloadLen,
        };
    }
}
exports.B01ChunkAssembler = B01ChunkAssembler;
//# sourceMappingURL=B01ChunkAssembler.js.map