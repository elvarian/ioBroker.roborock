"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StationService = void 0;
const deviceStateWriter_1 = require("../../deviceStateWriter");
const vacuumConstants_1 = require("../vacuumConstants");
class StationService {
    deps;
    stateWriter;
    constructor(deps, duid) {
        this.deps = deps;
        this.stateWriter = new deviceStateWriter_1.DeviceStateWriter(deps, duid);
    }
    async initDockingStationStatus() {
        await this.stateWriter.ensureFolder("dockingStationStatus");
        // Define status definitions with their respective translation keys for "Error/Maintenance" state (value 1)
        const statusDefinitions = {
            "cleanFluidStatus": "dock_info_clean_fluid_exception",
            "waterBoxFilterStatus": "dock_info_item_gone_exception",
            "dustBagStatus": "dock_info_dust_bag_exception",
            "dirtyWaterBoxStatus": "dock_info_dirty_water_box_exception1",
            "clearWaterBoxStatus": "dock_info_clear_water_box_exception1",
            "isUpdownWaterReady": "inner_error_name_152"
        };
        // Common states for 0 (Not Supported), 2 (OK), 3 (Unknown)
        const txtNotSupported = this.deps.adapter.translationManager.get("localization_strings_Setting_General_index_0", "Not supported");
        const txtOK = this.deps.adapter.translationManager.get("localization_strings_Main_Error_ErrorDetailPage_3", "OK");
        const txtUnknown = this.deps.adapter.translationManager.get("localization_strings_Setting_General_index_0", "Unknown");
        for (const [name, errorKey] of Object.entries(statusDefinitions)) {
            // If errorKey itself is not in translation, we use a generic native Roborock key as fallback.
            const commonFallbackKey = errorKey.includes("error_") ? "localization_strings_Main_Error_ErrorDetailPage_3" : "dust_collection_life12";
            const txtMaintenance = this.deps.adapter.translationManager.get(errorKey, this.deps.adapter.translationManager.get(commonFallbackKey));
            const states = {
                "0": txtNotSupported,
                "1": txtMaintenance,
                "2": txtOK,
                "3": txtUnknown
            };
            // Fetch localized name for the state itself
            const nameKey = vacuumConstants_1.VACUUM_CONSTANTS.dockingStationTranslationKeys[name];
            const localizedName = nameKey ? this.deps.adapter.translationManager.get(nameKey, name) : name;
            await this.stateWriter.ensureState(`dockingStationStatus.${name}`, {
                name: localizedName,
                type: "number",
                role: "value",
                read: true,
                write: false,
                states: states
            });
        }
    }
    async updateDockingStationStatus(dss) {
        const status = {
            cleanFluidStatus: ((dss >> 10) & 0b11),
            waterBoxFilterStatus: ((dss >> 8) & 0b11),
            dustBagStatus: ((dss >> 6) & 0b11),
            dirtyWaterBoxStatus: ((dss >> 4) & 0b11),
            clearWaterBoxStatus: ((dss >> 2) & 0b11),
            isUpdownWaterReady: (dss & 0b11),
        };
        for (const [name, val] of Object.entries(status)) {
            await this.stateWriter.setState(`dockingStationStatus.${name}`, val);
        }
    }
}
exports.StationService = StationService;
//# sourceMappingURL=StationService.js.map