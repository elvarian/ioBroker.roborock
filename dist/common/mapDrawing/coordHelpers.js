"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gridIndexToPixel = gridIndexToPixel;
exports.getCarpetPixel = getCarpetPixel;
exports.getPixelFromScaledDimensions = getPixelFromScaledDimensions;
/**
 * Shared coordinate helpers for V1 map drawing.
 * Grid index <-> pixel position. Used by both backend and frontend via drawMapV1.
 */
const constants_1 = require("./constants");
/** Pixel position for a single cell (e.g. floor, obstacle, carpet). */
function gridIndexToPixel(dimensions, pixelIndex) {
    const gridW = dimensions.width;
    const gridH = dimensions.height;
    const col = (pixelIndex * constants_1.VISUAL_BLOCK_SIZE) % (gridW * constants_1.VISUAL_BLOCK_SIZE);
    const row = gridH * constants_1.VISUAL_BLOCK_SIZE - Math.floor(pixelIndex / gridW) * constants_1.VISUAL_BLOCK_SIZE - constants_1.VISUAL_BLOCK_SIZE;
    return { x: col, y: row };
}
/** Carpet/getX/getY style: grid dimensions in *grid* units (unscaled). */
function getCarpetPixel(dimensions, pixelIndex) {
    const gridW = dimensions.width;
    const gridH = dimensions.height;
    const x = (pixelIndex * constants_1.VISUAL_BLOCK_SIZE) % (gridW * constants_1.VISUAL_BLOCK_SIZE);
    const y = gridH * constants_1.VISUAL_BLOCK_SIZE - Math.floor(pixelIndex / gridW) * constants_1.VISUAL_BLOCK_SIZE - constants_1.VISUAL_BLOCK_SIZE;
    return { x, y };
}
/** Backend uses dimensions already scaled (width/height in pixels). This returns pixel (x,y) for a grid index. */
function getPixelFromScaledDimensions(scaledWidth, scaledHeight, pixelIndex) {
    const gridW = scaledWidth / constants_1.VISUAL_BLOCK_SIZE;
    const x = (pixelIndex * constants_1.VISUAL_BLOCK_SIZE) % scaledWidth;
    const y = scaledHeight - Math.floor(pixelIndex / gridW) * constants_1.VISUAL_BLOCK_SIZE - constants_1.VISUAL_BLOCK_SIZE;
    return { x, y };
}
//# sourceMappingURL=coordHelpers.js.map