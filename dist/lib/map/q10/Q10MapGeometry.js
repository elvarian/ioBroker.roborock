"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Q10MapGeometry = exports.Q10_CANVAS_SCALE = void 0;
exports.getOriginalQ10MapRate = getOriginalQ10MapRate;
exports.getQ10ExportCanvasScale = getQ10ExportCanvasScale;
exports.Q10_CANVAS_SCALE = 8;
const ROOM_TAG_REFERENCE_VIEW_WIDTH = 360;
const ROOM_TAG_REFERENCE_VIEW_HEIGHT = 780;
function getOriginalQ10MapRate(width, height) {
    const maxSide = Math.max(width, height, 1);
    return Math.max(1, Math.floor(2000 / maxSide));
}
function getQ10ExportCanvasScale(width, height) {
    const originalScale = getOriginalQ10MapRate(width, height);
    return Math.max(3, Math.ceil(originalScale / 3) * 3);
}
class Q10MapGeometry {
    data;
    viewScale;
    canvasScale;
    constructor(data, viewScale = 1, canvasScale = exports.Q10_CANVAS_SCALE) {
        this.data = data;
        this.viewScale = viewScale;
        this.canvasScale = canvasScale;
    }
    mapPoint(point) {
        return {
            x: point.x * this.canvasScale,
            y: point.y * this.canvasScale
        };
    }
    mapPose(pose) {
        if (!pose)
            return undefined;
        return {
            x: pose.x * this.canvasScale,
            y: pose.y * this.canvasScale,
            phi: pose.phi
        };
    }
    mapLength(length) {
        return length * this.canvasScale;
    }
    layoutLengthInMap(layoutUnits) {
        return this.layoutLength(layoutUnits) / this.canvasScale;
    }
    layoutLength(layoutUnits) {
        return (layoutUnits * this.overlayExportScale()) / Math.max(this.viewScale, 0.001);
    }
    imgRateLength(layoutUnits) {
        return layoutUnits * this.roomTagReferenceKImgRate() * this.overlayExportScale();
    }
    quarterMeterTileLengthInMap() {
        return 0.25 / Math.max(this.data.header.resolution, 0.01);
    }
    quarterMeterTileLength() {
        return this.quarterMeterTileLengthInMap() * this.canvasScale;
    }
    mapCanvasSize() {
        return {
            width: Math.max(1, this.data.header.sizeX * this.canvasScale),
            height: Math.max(1, this.data.header.sizeY * this.canvasScale)
        };
    }
    originalMapRate() {
        return getOriginalQ10MapRate(this.data.header.sizeX, this.data.header.sizeY);
    }
    exportCanvasScale() {
        return getQ10ExportCanvasScale(this.data.header.sizeX, this.data.header.sizeY);
    }
    canvasScaleValue() {
        return this.canvasScale;
    }
    areaPlacement(area, outputSpace = "map") {
        const scale = outputSpace === "canvas" ? this.canvasScale : 1;
        const p0 = area.points[0];
        const p1 = area.points[1];
        const p3 = area.points[3];
        const angleRad = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        return {
            centerX: ((area.points[0].x + area.points[2].x) / 2) * scale,
            centerY: ((area.points[0].y + area.points[2].y) / 2) * scale,
            width: Math.hypot(p1.x - p0.x, p1.y - p0.y) * scale,
            height: Math.hypot(p3.x - p0.x, p3.y - p0.y) * scale,
            angleRad,
            angleDeg: (angleRad * 180) / Math.PI
        };
    }
    roomTagReferenceKImgRate() {
        const width = Math.max(1, this.data.header.sizeX);
        const height = Math.max(1, this.data.header.sizeY);
        const fitRateX = ROOM_TAG_REFERENCE_VIEW_WIDTH / width;
        const fitRateY = ROOM_TAG_REFERENCE_VIEW_HEIGHT / height;
        return Math.max(1, Math.min(fitRateX, fitRateY));
    }
    overlayExportScale() {
        return this.canvasScale / this.roomTagReferenceKImgRate();
    }
    roomTagExportScale() {
        return this.overlayExportScale();
    }
}
exports.Q10MapGeometry = Q10MapGeometry;
//# sourceMappingURL=Q10MapGeometry.js.map