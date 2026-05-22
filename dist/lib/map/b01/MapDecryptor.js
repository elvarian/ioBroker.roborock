"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapDecryptor = void 0;
const crypto = __importStar(require("node:crypto"));
const cryptoEngine_1 = require("../../cryptoEngine");
const MapHelper = __importStar(require("../MapHelper"));
const Q10YxMapParser_1 = require("../q10/Q10YxMapParser");
class MapDecryptor {
    /**
     * @doc:Encryption.md
     * ### B01 Map Decryption
     *
     * B01 map decryption. Follows the spec derived from the test fixture and docs; the original app
     * (see .cursorrules) handles 301 in o00O00OO.OooO0O0 → o00OO000.OooO00o.OooOooo / OooOooO, but the
     * exact layer implementation is not visible in the decompiled APK.
     *
     * Data flow: MQTT frame → messageParser.decodeMsg() reads
     * payloadLen (uint16 at offset 16), takes payload = frame.subarray(19, 19+payloadLen), then
     * decryptB01(payload, localKey, random) → data.payload. For 301 that buffer is passed to
     * getB01MapBuffer → decryptB01Payload → this decrypt(). So buf here is the inner payload after
     * outer B01 CBC only; no 301-specific header is stripped (unlike PhotoManager P301 dataSkip).
     * If buf starts with "B01", unwrapLayerCBC slices inner payload using payloadLen at buf[17..18].
     *
     * @see docs/map/B01_Map_Protocol.md
     * @see test/unit/b01_map_specification.test.ts
     */
    static decrypt(buf, serial, model, _duid, _adapter, localKey) {
        if (MapDecryptor.isSupportedB01MapPayload(buf))
            return MapDecryptor.normalizeSupportedPayload(buf);
        let current = buf;
        // 1. Layer 1: Protocol Wrapper (B01 AES-CBC); payload size from header (offset 17)
        current = MapDecryptor.unwrapLayerCBC(current, localKey);
        current = MapDecryptor.normalizeSupportedPayload(current);
        if (MapDecryptor.isSupportedB01MapPayload(current))
            return current;
        // 2. Layer 2: Transport Decoding (Base64)
        current = MapDecryptor.unwrapBase64(current);
        current = MapDecryptor.normalizeSupportedPayload(current);
        if (MapDecryptor.isSupportedB01MapPayload(current))
            return current;
        // 3. Layer 3: Map Data Encryption (AES-ECB)
        current = MapDecryptor.unwrapLayerECB(current, serial, model);
        current = MapDecryptor.normalizeSupportedPayload(current);
        if (MapDecryptor.isSupportedB01MapPayload(current))
            return current;
        // 4. Layer 4: Post-Cipher Transport Decoding (Hex-ASCII)
        current = MapDecryptor.unwrapHex(current);
        current = MapDecryptor.normalizeSupportedPayload(current);
        if (MapDecryptor.isSupportedB01MapPayload(current))
            return current;
        // 5. Layer 5: Decompression (ZLIB/GZIP)
        current = MapDecryptor.unwrapDecompression(current);
        current = MapDecryptor.normalizeSupportedPayload(current);
        const validB01Map = current && MapDecryptor.isSupportedB01MapPayload(current);
        return validB01Map ? current : null;
    }
    static unwrapBase64(current) {
        const checkStr = current.subarray(0, Math.min(current.length, 100)).toString("utf8");
        if (/^[A-Za-z0-9+/= \r\n]+$/.test(checkStr)) {
            try {
                const decoded = Buffer.from(current.toString("utf8"), "base64");
                if (decoded.length > 0 && decoded.length !== current.length)
                    return decoded;
            }
            catch { }
        }
        return current;
    }
    static unwrapHex(current) {
        const checkStr = current.subarray(0, Math.min(current.length, 100)).toString("utf8");
        if (/^[0-9a-fA-F]+$/.test(checkStr.substring(0, 10)) && (checkStr.startsWith("78") || checkStr.startsWith("1f"))) {
            try {
                const decoded = Buffer.from(current.toString("utf8"), "hex");
                if (decoded.length > 0 && decoded.length !== current.length)
                    return decoded;
            }
            catch { }
        }
        return current;
    }
    static unwrapLayerCBC(current, localKey) {
        if (current.length > 19 && current.toString("ascii", 0, 3) === "B01") {
            try {
                const ivSeed = current.readUInt32BE(7);
                const payloadLen = current.readUInt16BE(17);
                const payload = current.subarray(19, 19 + payloadLen);
                if (localKey) {
                    const derivedIV = cryptoEngine_1.cryptoEngine.deriveB01IV(ivSeed);
                    const decrypted = MapDecryptor.decryptCBC(payload, localKey, derivedIV);
                    if (decrypted)
                        return decrypted;
                }
            }
            catch (e) {
                MapDecryptor.logDebug(undefined, `Layer 1: CBC Decryption failed: ${e.message}`, "warn");
            }
        }
        return current;
    }
    static unwrapLayerECB(current, serial, model) {
        if (!serial || !model || current.length % 16 !== 0)
            return current;
        try {
            const mapKey = MapDecryptor.deriveMapKey(serial, model);
            const decrypted = MapDecryptor.decryptECB(current, mapKey);
            // After ECB: zlib (0x78) or gzip (0x1f), or hex-ASCII "78"/"1f" (0x37 0x38 / 0x31 0x66)
            if (decrypted && decrypted.length > 0 && (decrypted[0] === 0x78 || decrypted[0] === 0x1f || (decrypted[0] === 0x37 && decrypted[1] === 0x38) || (decrypted[0] === 0x31 && decrypted[1] === 0x66)))
                return decrypted;
        }
        catch (e) {
            MapDecryptor.logDebug(undefined, `Layer 3: ECB failed: ${e.message}`, "warn");
        }
        return current;
    }
    static unwrapDecompression(current) {
        return MapHelper.decompress(current);
    }
    static deriveMapKey(serial, model) {
        const modelSuffix = model.includes(".") ? model.split(".").pop() : model;
        // Standard key derivation
        let p = modelSuffix;
        while (p.length < 16)
            p += "0";
        const key = Buffer.from(p.substring(0, 16), "utf8");
        const inputStr = `${serial}+${modelSuffix}+${serial}`;
        const inputBuf = Buffer.from(inputStr, "utf8");
        // Apply PKCS7 padding
        const z = 16 - (inputBuf.length % 16);
        const paddedInput = Buffer.concat([inputBuf, Buffer.alloc(z, z)]);
        const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
        cipher.setAutoPadding(false);
        let encrypted = cipher.update(paddedInput);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const hash = crypto.createHash("md5").update(encrypted.toString("base64")).digest("hex");
        return Buffer.from(hash.substring(8, 24).toLowerCase(), "utf8");
    }
    static decryptECB(encrypted, key) {
        const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
        decipher.setAutoPadding(true);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }
    static decryptCBC(encrypted, key, iv) {
        try {
            const keyBuf = typeof key === "string" ? Buffer.from(key, "utf8") : key;
            const decipher = crypto.createDecipheriv("aes-128-cbc", keyBuf, iv);
            decipher.setAutoPadding(true);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]);
        }
        catch {
            return null;
        }
    }
    static isSignatureMatch(buf) {
        return MapHelper.isSignatureMatch(buf);
    }
    static isLikelyProtobuf(buf) {
        return MapHelper.isLikelyProtobuf(buf);
    }
    /** True if decrypted payload is a B01 history/cleaning map (08 15 12...), not live (08 00 12...). */
    static isHistoryMap(buf) {
        return buf != null && buf.length >= 3 && buf[0] === 0x08 && buf[1] === 0x15 && buf[2] === 0x12;
    }
    /** True only if buf is a B01 map protobuf: 08 00 12 (live) or 08 15 12 (history). Rejects other protobufs (e.g. 0a ...). */
    static isB01MapProtobuf(buf) {
        return buf != null && buf.length >= 3 && buf[0] === 0x08 && buf[2] === 0x12 && (buf[1] === 0x00 || buf[1] === 0x15);
    }
    static isLikelyQ10MapPayload(buf) {
        return (0, Q10YxMapParser_1.isQ10YxMapPayload)(buf) || (buf.length > 1 && buf[0] === 1 && (0, Q10YxMapParser_1.isQ10YxMapPayload)(buf.subarray(1)));
    }
    static getQ10BlobType(buf) {
        if (!buf || buf.length < 2)
            return null;
        const blobType = buf[0];
        return blobType === 1 || blobType === 2 || blobType === 3 || blobType === 4 ? blobType : null;
    }
    static isLikelyQ10BlobPayload(buf) {
        const blobType = MapDecryptor.getQ10BlobType(buf);
        if (blobType === null)
            return false;
        if (blobType === 1) {
            return MapDecryptor.isLikelyQ10MapPayload(buf);
        }
        if (blobType === 2) {
            return buf.length >= 14;
        }
        if (blobType === 3 || blobType === 4) {
            return buf.length >= 28;
        }
        return false;
    }
    static isSupportedB01MapPayload(buf) {
        const normalized = MapDecryptor.normalizeSupportedPayload(buf);
        return MapDecryptor.isB01MapProtobuf(normalized) || MapDecryptor.isLikelyQ10MapPayload(normalized) || MapDecryptor.isLikelyQ10BlobPayload(normalized);
    }
    /**
     * Runs Layers 2–5 (Base64 → ECB → Hex → Decompress) on a buffer that is already
     * the concatenated output of Layer 1 (e.g. from multiple B01 chunks decrypted separately).
     * Use for chunked B01 streams where each chunk has its own B01 header and IV.
     */
    static decryptFromLayer2(layer1Concatenated, serial, model, _duid, _adapter, _localKey) {
        void _duid;
        void _adapter;
        void _localKey;
        if (MapDecryptor.isSupportedB01MapPayload(layer1Concatenated))
            return MapDecryptor.normalizeSupportedPayload(layer1Concatenated);
        let current = layer1Concatenated;
        current = MapDecryptor.unwrapBase64(current);
        current = MapDecryptor.normalizeSupportedPayload(current);
        if (MapDecryptor.isSupportedB01MapPayload(current))
            return current;
        current = MapDecryptor.unwrapLayerECB(current, serial, model);
        current = MapDecryptor.normalizeSupportedPayload(current);
        if (MapDecryptor.isSupportedB01MapPayload(current))
            return current;
        current = MapDecryptor.unwrapHex(current);
        current = MapDecryptor.normalizeSupportedPayload(current);
        if (MapDecryptor.isSupportedB01MapPayload(current))
            return current;
        current = MapDecryptor.unwrapDecompression(current);
        current = MapDecryptor.normalizeSupportedPayload(current);
        return current && MapDecryptor.isSupportedB01MapPayload(current) ? current : null;
    }
    /** Decrypts only Layer 1 (B01 AES-CBC wrapper). Returns inner payload (e.g. base64 or binary). */
    static decryptLayer1Only(buf, localKey) {
        if (buf.length <= 19 || buf.toString("ascii", 0, 3) !== "B01")
            return null;
        try {
            const payloadLen = buf.readUInt16BE(17);
            if (19 + payloadLen > buf.length)
                return null;
            const payload = buf.subarray(19, 19 + payloadLen);
            if (!localKey)
                return null;
            const ivSeed = buf.readUInt32BE(7);
            const derivedIV = cryptoEngine_1.cryptoEngine.deriveB01IV(ivSeed);
            const decrypted = MapDecryptor.decryptCBC(payload, localKey, derivedIV);
            return decrypted;
        }
        catch {
            return null;
        }
    }
    static normalizeSupportedPayload(buf) {
        return buf;
    }
    static logDebug(adapter, msg, level = "debug") {
        if (adapter && (level === "warn" || level === "error")) {
            if (typeof adapter.rLog === "function") {
                adapter.rLog("System", null, level === "warn" ? "Warn" : "Error", "B01Decrypt", undefined, msg, level);
            }
            else if (adapter.log) {
                if (level === "warn")
                    adapter.log.warn(`B01Decrypt: ${msg}`);
                else
                    adapter.log.error(`B01Decrypt: ${msg}`);
            }
        }
    }
}
exports.MapDecryptor = MapDecryptor;
//# sourceMappingURL=MapDecryptor.js.map