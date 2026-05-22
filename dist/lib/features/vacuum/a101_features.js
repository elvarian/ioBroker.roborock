"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.A101Features = void 0;
const baseDeviceFeatures_1 = require("../baseDeviceFeatures");
const features_enum_1 = require("../features.enum");
const v1VacuumFeatures_1 = require("./v1VacuumFeatures");
const PROFILE_A101 = {
    name: "Roborock Q Revo Pro (a101)",
    features: {
        maxSuctionValue: 108,
        hasSmartPlan: true,
        hasDistanceOff: true
    },
    mappings: {
        fan_power: { ...v1VacuumFeatures_1.BASE_FAN, 101: "Quiet", 102: "Balanced", 103: "Turbo", 104: "Max", 106: "Custom", 108: "Max+", 110: "Smart" },
        water_box_mode: { ...v1VacuumFeatures_1.BASE_WATER, 201: "Low", 202: "Medium", 203: "High", 204: "Indiv", 207: "Custom", 209: "Smart" },
        mop_mode: { ...v1VacuumFeatures_1.BASE_MOP, 300: "Standard", 301: "Deep", 302: "Indiv", 303: "Deep+", 304: "Fast", 306: "Smart" }
    },
    cleanMotorModePresets: {
        '{"fan_power":110,"mop_mode":306,"water_box_mode":209}': "Smart",
        '{"fan_power":102,"mop_mode":300,"water_box_mode":201}': "Vac & Mop",
        '{"fan_power":105,"mop_mode":300,"water_box_mode":201}': "Wischen",
        '{"fan_power":102,"mop_mode":300,"water_box_mode":200}': "Saugen",
        '{"fan_power":106,"mop_mode":302,"water_box_mode":204}': "Indiv"
    }
};
const a101Config = {
    staticFeatures: [
        features_enum_1.Feature.DockStatus,
        features_enum_1.Feature.RobotStatus,
        features_enum_1.Feature.InWarmup,
        features_enum_1.Feature.LastCleanTime,
        features_enum_1.Feature.MapFlag,
        features_enum_1.Feature.BackType,
        features_enum_1.Feature.ChargeStatus,
        features_enum_1.Feature.CleanPercent,
        features_enum_1.Feature.SwitchStatus,
        features_enum_1.Feature.MopForbidden,
        features_enum_1.Feature.AvoidCarpet,
        features_enum_1.Feature.ShakeMopStrength,
        features_enum_1.Feature.WaterBox,
        features_enum_1.Feature.AutoEmptyDock,
        features_enum_1.Feature.MopWash,
        features_enum_1.Feature.MopDry,
        features_enum_1.Feature.FanMaxPlus,
        features_enum_1.Feature.SmartModeCommand,
        features_enum_1.Feature.CleanRepeat
    ]
};
let A101Features = class A101Features extends v1VacuumFeatures_1.V1VacuumFeatures {
    constructor(dependencies, duid) {
        super(dependencies, duid, "roborock.vacuum.a101", a101Config, PROFILE_A101);
    }
};
exports.A101Features = A101Features;
exports.A101Features = A101Features = __decorate([
    (0, baseDeviceFeatures_1.RegisterModel)("roborock.vacuum.a101"),
    __metadata("design:paramtypes", [Object, String])
], A101Features);
//# sourceMappingURL=a101_features.js.map