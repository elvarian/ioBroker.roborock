"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getB01VariantFromModel = getB01VariantFromModel;
/**
 * Derives the B01 variant from the robot model.
 * Q10 devices use the "ss" family (for example ss09), while classic B01/Q7
 * devices use "sc" or other non-ss suffixes.
 */
function getB01VariantFromModel(robotModel) {
    const segment = robotModel.split(".").pop() ?? robotModel;
    return segment.toLowerCase().startsWith("ss") ? "Q10" : "Q7";
}
//# sourceMappingURL=b01Variant.js.map