"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_COLORS = exports.ROBOROCK_PALETTE = exports.VISUAL_BLOCK_SIZE = void 0;
exports.hexToRgba = hexToRgba;
exports.hexToRgbaString = hexToRgbaString;
/** Shared map drawing constants. Single source for V1 map scale and colors. */
exports.VISUAL_BLOCK_SIZE = 3;
exports.ROBOROCK_PALETTE = [
    "#DFDFDFff", "#50A4FF", "#FF744D", "#008FA8", "#F5AF10", "#E9E9E9ff"
];
exports.LEGACY_COLORS = {
    floor: "#23465e",
    obstacle: "#2b2e30",
    path: "#FFFFFF",
};
function hexToRgba(hex, alpha = 255) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, alpha];
}
/** For ctx.fillStyle / SVG fill (0–255 alpha). */
function hexToRgbaString(hex, alpha = 255) {
    const [r, g, b, a] = hexToRgba(hex, alpha);
    return `rgba(${r},${g},${b},${a / 255})`;
}
//# sourceMappingURL=constants.js.map