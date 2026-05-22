"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.B01ConsumableService = void 0;
const deviceStateWriter_1 = require("../../deviceStateWriter");
const vacuumConstants_1 = require("../vacuumConstants");
class B01ConsumableService {
    deps;
    duid;
    stateWriter;
    constructor(deps, duid) {
        this.deps = deps;
        this.duid = duid;
        this.stateWriter = new deviceStateWriter_1.DeviceStateWriter(deps, duid);
    }
    PROP_MAP = {
        main_brush: "main_brush_work_time",
        side_brush: "side_brush_work_time",
        hypa: "filter_work_time",
        main_sensor: "sensor_dirty_time",
        filter_element: "filter_element_work_time"
    };
    async updateConsumables(data) {
        let resultObj;
        if (data) {
            resultObj = data;
        }
        else {
            const props = vacuumConstants_1.VACUUM_CONSTANTS.b01SettingsProps;
            const result = await this.deps.adapter.requestsHandler.sendRequest(this.duid, "prop.get", { property: props });
            if (Array.isArray(result) && result.length === props.length) {
                resultObj = {};
                for (let i = 0; i < props.length; i++) {
                    const key = props[i];
                    const mappedKey = this.PROP_MAP[key] || key;
                    resultObj[mappedKey] = result[i];
                }
            }
            else if (typeof result === "object" && result !== null) {
                resultObj = result;
            }
        }
        if (resultObj) {
            await this.processConsumables(resultObj);
        }
    }
    async processConsumables(resultObj) {
        await this.stateWriter.ensureFolder("consumables");
        await this.stateWriter.ensureFolder("resetConsumables");
        for (const key in resultObj) {
            if (!key.endsWith("_work_time") && !key.endsWith("_work_times") && !key.endsWith("_dirty_time")) {
                continue;
            }
            let val = resultObj[key];
            // Consumable name normalization
            const deviceName = key.replace(/(_work_times|_work_time|_dirty_time)$/, "");
            const translationKey = vacuumConstants_1.VACUUM_CONSTANTS.consumableTranslationKeys[deviceName];
            const localizedName = translationKey ? this.deps.adapter.translationManager.get(translationKey, deviceName) : deviceName;
            let unit = "";
            let suffix = "";
            if (key.endsWith("_work_times")) {
                unit = "cycles";
                suffix = " cycles";
            }
            else if (key.endsWith("_work_time") || key.endsWith("_dirty_time")) {
                const totalSeconds = this.getConsumableLifeSpan(deviceName) * 3600;
                if (totalSeconds > 0) {
                    // Convert seconds used to remaining hours
                    val = Math.max(0, Math.round((totalSeconds - val) / 3600));
                    unit = "h";
                    suffix = " remaining time";
                }
                else {
                    unit = "s";
                    suffix = " work time";
                }
            }
            // Create/Update the raw state exactly as it comes from the robot (but converted to h if applicable)
            await this.stateWriter.ensureAndSetValueState(`consumables.${key}`, {
                name: `${localizedName}${suffix}`,
                type: "number",
                role: "value",
                unit: unit,
                write: false
            }, val);
            // Reset Button
            const resetKey = `reset_${deviceName}`;
            await this.stateWriter.ensureState(`resetConsumables.${resetKey}`, {
                name: `Reset ${localizedName}`,
                type: "boolean",
                role: "button",
                write: true,
                def: false
            }, { resetParam: key });
        }
    }
    getConsumableLifeSpan(deviceName) {
        switch (deviceName) {
            case "main_brush": return 300;
            case "side_brush": return 200;
            case "filter":
            case "filter_element": return 150;
            case "sensor": return 30;
            case "strainer": return 150;
            case "cleaning_brush": return 300;
            default: return 0;
        }
    }
}
exports.B01ConsumableService = B01ConsumableService;
//# sourceMappingURL=B01ConsumableService.js.map