"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isB01ParkedState = isB01ParkedState;
exports.isB01DockAnchoredState = isB01DockAnchoredState;
const B01_PARKED_STATES = new Set([
    4,
    8,
    100
]);
const B01_DOCK_ANCHORED_STATES = new Set([
    ...B01_PARKED_STATES,
    15,
    22
]);
function isB01ParkedState(stateCode) {
    return typeof stateCode === "number" && B01_PARKED_STATES.has(stateCode);
}
function isB01DockAnchoredState(stateCode) {
    return typeof stateCode === "number" && B01_DOCK_ANCHORED_STATES.has(stateCode);
}
//# sourceMappingURL=B01StateSemantics.js.map