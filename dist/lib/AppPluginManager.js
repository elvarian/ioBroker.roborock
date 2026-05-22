"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppPluginManager = void 0;
const JSZip = __importStar(require("jszip"));
const path = __importStar(require("node:path"));
class AppPluginManager {
    adapter;
    constructor(adapter) {
        this.adapter = adapter;
    }
    async downloadAppPlugins() {
        const loginApi = this.adapter.http_api.loginApi;
        if (!loginApi) {
            this.adapter.rLog("System", null, "Error", undefined, undefined, "loginApi not initialized in AppPluginManager", "error");
            return;
        }
        try {
            // Ensure we have V5 product info (numeric IDs)
            await this.adapter.http_api.ensureProductInfo();
            // Future: Integrate automated plugin discovery and background updates
        }
        catch (e) {
            this.adapter.rLog("System", null, "Error", undefined, undefined, `Failed to prepare for app plugin download: ${this.adapter.errorMessage(e)}`, "error");
            return;
        }
    }
    static ASSETS_BASE = "assets";
    async hasAssetsForModel(model) {
        if (!model || model === "default")
            return true;
        const versionFilePath = `${AppPluginManager.ASSETS_BASE}/${model}/version`;
        try {
            return await this.adapter.fileExistsAsync(this.adapter.name, versionFilePath);
        }
        catch {
            return false;
        }
    }
    /** Download assets for model if version file missing (startup only). */
    async downloadAssetsForModelIfMissing(model) {
        if (!model || model === "default")
            return;
        if (await this.hasAssetsForModel(model))
            return;
        const loginApi = this.adapter.http_api.loginApi;
        if (!loginApi)
            return;
        const devices = this.adapter.http_api.getDevices() || [];
        const deviceWithModel = devices.find(d => this.adapter.http_api.getRobotModel(d.duid) === model);
        if (deviceWithModel) {
            await this.updateProduct(deviceWithModel.duid);
            return;
        }
        await this.adapter.http_api.ensureProductInfo();
        const numericProductId = this.adapter.http_api.getProductIdByModel(model) || 0;
        if (numericProductId <= 0)
            return;
        const appPluginRequest = { apilevel: 10042, type: 2, productids: [numericProductId] };
        const vacuumIDs = { [numericProductId.toString()]: model };
        try {
            const packageData = await loginApi.post("api/v1/appplugin", appPluginRequest);
            if (packageData.data.code !== 200)
                return;
            const packages = packageData.data.data;
            for (const rr_package in packages) {
                let vacuumModel = vacuumIDs[packages[rr_package].productid];
                if (!vacuumModel)
                    vacuumModel = model;
                if (vacuumModel !== model)
                    continue;
                const zipUrl = packages[rr_package].url;
                const newVersion = packages[rr_package].version;
                await this.downloadAndExtractAssetZip(loginApi, zipUrl, vacuumModel, newVersion, null);
                return;
            }
        }
        catch {
            // ignore
        }
    }
    async downloadAndExtractAssetZip(loginApi, zipUrl, vacuumModel, newVersion, duid) {
        const assetDir = `${AppPluginManager.ASSETS_BASE}/${vacuumModel}`;
        const versionFilePath = `${assetDir}/version`;
        let reason = "";
        const versionExists = await this.adapter.fileExistsAsync(this.adapter.name, versionFilePath);
        if (!versionExists) {
            try {
                await this.adapter.readDirAsync(this.adapter.name, assetDir);
                reason = "Version file missing";
            }
            catch {
                reason = "Assets missing";
            }
        }
        else {
            const versionResult = await this.adapter.readFileAsync(this.adapter.name, versionFilePath);
            const content = (typeof versionResult === "object" && versionResult !== null && "file" in versionResult)
                ? versionResult.file.toString("utf8").trim() : String(versionResult).trim();
            const cur = parseInt(content, 10);
            const rem = parseInt(newVersion, 10);
            if (isNaN(rem) || (!isNaN(cur) && rem <= cur))
                return true;
            reason = `New version (${cur} → ${rem})`;
        }
        try {
            await this.adapter.mkdirAsync(this.adapter.name, assetDir);
        }
        catch (e) {
            this.adapter.rLog("System", duid ?? null, "Error", undefined, undefined, `Could not create asset directory ${assetDir}: ${e}`, "error");
            return false;
        }
        this.adapter.rLog("Cloud", duid ?? null, "Info", undefined, undefined, `Downloading assets for ${vacuumModel} (${reason})...`, "info");
        try {
            const response = await loginApi.get(zipUrl, { responseType: "arraybuffer" });
            const zip = await JSZip.loadAsync(response.data);
            let extractedCount = 0;
            const filePromises = [];
            const createdDirs = new Set();
            zip.forEach((relativePath, file) => {
                const isTarget = relativePath.startsWith("drawable-") || relativePath.startsWith("raw/");
                if (isTarget && !file.dir) {
                    filePromises.push((async () => {
                        const fileContent = await file.async("nodebuffer");
                        if (fileContent) {
                            const targetPath = `${assetDir}/${relativePath}`;
                            const targetDir = path.dirname(targetPath).replace(/\\/g, "/");
                            if (!createdDirs.has(targetDir)) {
                                createdDirs.add(targetDir);
                                await this.adapter.mkdirAsync(this.adapter.name, targetDir);
                            }
                            await this.adapter.writeFileAsync(this.adapter.name, targetPath, fileContent);
                            extractedCount++;
                        }
                    })());
                }
            });
            await Promise.all(filePromises);
            if (extractedCount > 0) {
                this.adapter.rLog("Cloud", duid ?? null, "Info", undefined, undefined, `Extracted ${extractedCount} assets to ${assetDir}`, "info");
                try {
                    const versionBuf = Buffer.from(String(newVersion), "utf8");
                    await this.adapter.writeFileAsync(this.adapter.name, versionFilePath, versionBuf);
                }
                catch (e) {
                    this.adapter.rLog("Cloud", duid ?? null, "Error", undefined, undefined, `Failed to write version file ${versionFilePath}: ${this.adapter.errorMessage(e)}`, "error");
                    return false;
                }
                return true;
            }
            this.adapter.rLog("Cloud", duid ?? null, "Warn", undefined, undefined, `No assets found in zip for ${vacuumModel}.`, "warn");
        }
        catch (err) {
            this.adapter.rLog("Cloud", duid ?? null, "Error", undefined, undefined, `Failed to download/extract assets for ${vacuumModel}: ${this.adapter.errorMessage(err)}`, "error");
        }
        return false;
    }
    async updateProduct(duid) {
        const loginApi = this.adapter.http_api.loginApi;
        if (!loginApi) {
            this.adapter.rLog("System", null, "Error", undefined, undefined, "loginApi not initialized in AppPluginManager", "error");
            return;
        }
        const devices = this.adapter.http_api.getDevices();
        const device = devices.find(d => d.duid === duid);
        if (!device) {
            this.adapter.rLog("Cloud", duid, "Warn", undefined, undefined, "Cannot update product assets: Device not found.", "warn");
            return;
        }
        const appPluginRequest = { apilevel: 1000, type: 2 };
        let numericProductId = 0;
        await this.adapter.http_api.ensureProductInfo();
        let vacuumModel = "unknown_model";
        const modelStr = this.adapter.http_api.getRobotModel(duid);
        if (modelStr)
            vacuumModel = modelStr;
        const resolvedId = this.adapter.http_api.getProductIdByModel(vacuumModel);
        if (resolvedId) {
            numericProductId = resolvedId;
        }
        else {
            const productInfo = this.adapter.http_api.productInfo;
            const hasV3 = !!(this.adapter.http_api.homeData && this.adapter.http_api.homeData.products);
            const hasV5 = !!(productInfo && productInfo.data);
            let v5Count = 0;
            if (productInfo?.data?.categoryDetailList) {
                for (const c of productInfo.data.categoryDetailList) {
                    if (c.productList)
                        v5Count += c.productList.length;
                }
            }
            const v5List = `V5Products(${v5Count})`;
            this.adapter.rLog("Cloud", duid, "Warn", undefined, undefined, `Could not find numeric ID for ${vacuumModel}. V3Products: ${hasV3}, V5Data: ${hasV5}, V5Counts: ${v5List}`, "warn");
        }
        if (numericProductId > 0) {
            appPluginRequest.productids = [numericProductId];
            appPluginRequest.apilevel = 10042;
        }
        else {
            this.adapter.rLog("Cloud", duid, "Warn", undefined, undefined, `Falling back to request with string productId ${device.productId} (might fail)`, "warn");
        }
        const vacuumIDs = {
            [device.productId]: vacuumModel,
            [numericProductId.toString()]: vacuumModel
        };
        try {
            const packageData = await loginApi.post("api/v1/appplugin", appPluginRequest);
            if (packageData.data.code !== 200) {
                this.adapter.rLog("Cloud", duid, "Warn", undefined, undefined, `AppPlugin (assets) request failed: ${JSON.stringify(packageData.data)}`, "warn");
                return;
            }
            const packages = packageData.data.data;
            const processedModels = new Set();
            for (const rr_package in packages) {
                let vacuumModel = vacuumIDs[packages[rr_package].productid];
                if (!vacuumModel)
                    vacuumModel = "unknown";
                if (vacuumModel === "unknown_model" || !vacuumModel) {
                    const pid = packages[rr_package].productid;
                    if (pid == numericProductId || pid == device.productId)
                        vacuumModel = modelStr || "unknown";
                }
                if (!vacuumModel || vacuumModel === "unknown" || processedModels.has(vacuumModel))
                    continue;
                processedModels.add(vacuumModel);
                // Skip if another caller already downloaded (e.g. single-flight finished)
                if (await this.hasAssetsForModel(vacuumModel))
                    continue;
                const zipUrl = packages[rr_package].url;
                const newVersion = packages[rr_package].version;
                await this.downloadAndExtractAssetZip(loginApi, zipUrl, vacuumModel, newVersion, duid);
            }
        }
        catch (e) {
            this.adapter.rLog("Cloud", duid, "Error", undefined, undefined, `Failed to update product assets: ${this.adapter.errorMessage(e)}`, "error");
        }
    }
}
exports.AppPluginManager = AppPluginManager;
//# sourceMappingURL=AppPluginManager.js.map