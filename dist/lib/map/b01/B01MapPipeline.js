"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.B01MapPipeline = void 0;
const B01MapPayloadClassifier_1 = require("./B01MapPayloadClassifier");
const MapDecryptor_1 = require("./MapDecryptor");
const MapParser_1 = require("./MapParser");
class B01MapPipeline {
    adapter;
    parser;
    constructor(adapter) {
        this.adapter = adapter;
        this.parser = new MapParser_1.MapParser(adapter);
    }
    resolve(rawData, version, model, serial, duid, connectionType) {
        for (const candidate of this.collectCandidates(rawData, version, model, serial, duid)) {
            const classification = (0, B01MapPayloadClassifier_1.classifyB01MapPayload)(candidate);
            if (!classification.isMapPayload)
                continue;
            if (classification.variant === "q10" && classification.q10) {
                return {
                    variant: "q10",
                    payload: candidate,
                    classification,
                    mapData: classification.q10.mapData,
                    q10: classification.q10
                };
            }
            if (classification.variant === "protobuf") {
                return {
                    variant: "protobuf",
                    payload: candidate,
                    classification,
                    mapData: this.parser.parseProtobuf(candidate, duid, connectionType),
                    q10: null
                };
            }
        }
        return null;
    }
    collectCandidates(rawData, version, model, serial, duid) {
        const candidates = [];
        const pushUnique = (candidate) => {
            if (!candidate || candidate.length === 0)
                return;
            if (candidates.some((existing) => existing.equals(candidate)))
                return;
            candidates.push(candidate);
        };
        pushUnique(rawData);
        if ((0, B01MapPayloadClassifier_1.classifyB01MapPayload)(rawData).isMapPayload)
            return candidates;
        if (version !== "B01")
            return candidates;
        const localKey = this.adapter.http_api?.getMatchedLocalKeys
            ? this.adapter.http_api.getMatchedLocalKeys().get(duid)
            : undefined;
        const decrypted = MapDecryptor_1.MapDecryptor.decrypt(rawData, serial, model, duid, this.adapter, localKey);
        pushUnique(decrypted);
        if (decrypted && (0, B01MapPayloadClassifier_1.classifyB01MapPayload)(decrypted).isMapPayload)
            return candidates;
        pushUnique(MapDecryptor_1.MapDecryptor.decryptLayer1Only(rawData, localKey));
        return candidates;
    }
}
exports.B01MapPipeline = B01MapPipeline;
//# sourceMappingURL=B01MapPipeline.js.map