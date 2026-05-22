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
exports.TranslationManager = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
class TranslationManager {
    adapter;
    translations = {};
    currentLanguage = "en";
    constructor(adapter) {
        this.adapter = adapter;
    }
    init() {
        const systemLang = (this.adapter.language || "en").toString().toLowerCase();
        this.currentLanguage = this.resolveLanguage(systemLang);
        this.adapter.rLog("System", null, "Info", undefined, undefined, `[Translation] System language="${this.adapter.language}" normalized="${systemLang}" selected="${this.currentLanguage}"`, "info");
        this.loadTranslations();
    }
    loadTranslations() {
        const jsonPath = path.join(__dirname, "..", "..", "lib", "protocols", "roborock_strings.json");
        this.adapter.rLog("System", null, "Debug", undefined, undefined, `[Translation] Loading translations from ${jsonPath}`, "debug");
        try {
            if (fs.existsSync(jsonPath)) {
                const data = fs.readFileSync(jsonPath, "utf8");
                const rawTranslations = JSON.parse(data);
                // Re-index all keys to lowercase to ensure case-insensitive lookups
                this.translations = {};
                for (const [lang, keys] of Object.entries(rawTranslations)) {
                    this.translations[lang] = {};
                    for (const [key, val] of Object.entries(keys)) {
                        this.translations[lang][key.toLowerCase()] = val;
                    }
                }
                const langCount = Object.keys(this.translations).length;
                const currentKeys = this.translations[this.currentLanguage] ? Object.keys(this.translations[this.currentLanguage]).length : 0;
                this.adapter.rLog("System", null, "Info", undefined, undefined, `[Translation] Loaded ${langCount} languages. Current language "${this.currentLanguage}" has ${currentKeys} keys.`, "info");
            }
            else {
                this.adapter.rLog("System", null, "Error", undefined, undefined, `[Translation] File not found at ${jsonPath}`, "error");
            }
        }
        catch (e) {
            this.adapter.rLog("System", null, "Error", undefined, undefined, `[Translation] Failed to load translations: ${e instanceof Error ? e.message : String(e)}`, "error");
        }
    }
    resolveLanguage(lang) {
        const LANGUAGE_MAP = {
            "zh-cn": "zh-hans",
            "zh-tw": "zh-hant",
            "zh-hk": "zh-hk",
            "de-de": "de",
            "en-us": "en",
            "en-gb": "en"
        };
        if (LANGUAGE_MAP[lang]) {
            return LANGUAGE_MAP[lang];
        }
        if (lang.includes("-")) {
            const base = lang.split("-")[0];
            if (LANGUAGE_MAP[base])
                return LANGUAGE_MAP[base];
            return base;
        }
        return lang;
    }
    get(key, defaultVal) {
        const lookupKey = key.toLowerCase();
        // Try exact match in loaded Roborock translations
        if (this.translations[this.currentLanguage] && this.translations[this.currentLanguage][lookupKey]) {
            return this.translations[this.currentLanguage][lookupKey];
        }
        // Try English fallback in loaded Roborock translations
        if (this.currentLanguage !== "en" && this.translations["en"] && this.translations["en"][lookupKey]) {
            return this.translations["en"][lookupKey];
        }
        // Return defaultVal or key if translation completely missing
        return defaultVal !== undefined ? defaultVal : key;
    }
}
exports.TranslationManager = TranslationManager;
//# sourceMappingURL=translationManager.js.map