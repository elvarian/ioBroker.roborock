"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceStateWriter = void 0;
class DeviceStateWriter {
    deps;
    duid;
    constructor(deps, duid) {
        this.deps = deps;
        this.duid = duid;
    }
    path(relativePath = "") {
        return relativePath ? `Devices.${this.duid}.${relativePath}` : `Devices.${this.duid}`;
    }
    async ensureFolder(relativePath, name) {
        if (name === undefined) {
            await this.deps.ensureFolder(this.path(relativePath));
            return;
        }
        await this.deps.ensureFolder(this.path(relativePath), name);
    }
    async ensureState(relativePath, common, native = {}) {
        if (Object.keys(native).length === 0) {
            await this.deps.ensureState(this.path(relativePath), common);
            return;
        }
        await this.deps.ensureState(this.path(relativePath), common, native);
    }
    async setState(relativePath, value) {
        await this.deps.adapter.setStateChanged(this.path(relativePath), { val: value, ack: true });
    }
    async ensureAndSetState(relativePath, common, value, native = {}) {
        await this.ensureState(relativePath, common, native);
        await this.setState(relativePath, value);
    }
    async ensureAndSetValueState(relativePath, common, value, native = {}) {
        await this.ensureAndSetState(relativePath, {
            role: "value",
            read: true,
            write: false,
            ...common
        }, value, native);
    }
}
exports.DeviceStateWriter = DeviceStateWriter;
//# sourceMappingURL=deviceStateWriter.js.map