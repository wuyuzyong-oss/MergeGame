import * as itemsConfig from '../configs/items.json';
import * as generatorsConfig from '../configs/generators.json';
import { GeneratorData } from './generator/GeneratorData';

/**
 * 物品配置数据
 */
export interface ItemConfig {
    itemId: string;
    chainId: string;
    level: number;
    nextItemId: string | null;
    maxLevel: number;
    isGenerator?: boolean;
}

// 复用 generator/GeneratorData 中的接口定义

/**
 * 配置管理器
 * 负责加载和管理 items.json、generators.json 等配置数据
 */
export class ConfigManager {
    private static _instance: ConfigManager = new ConfigManager();
    public static get instance(): ConfigManager {
        return ConfigManager._instance;
    }

    private _itemConfigMap: Map<string, ItemConfig> = new Map();
    private _generatorConfigMap: Map<string, GeneratorData> = new Map();

    constructor() {
        this.loadItemConfig();
        this.loadGeneratorConfig();
    }

    private loadItemConfig(): void {
        const itemsData = (itemsConfig as any).default ?? itemsConfig;
        const items = itemsData?.items as ItemConfig[];
        if (!items || !Array.isArray(items)) {
            console.error('[ConfigManager] items.json format error');
            return;
        }

        this._itemConfigMap.clear();
        for (const config of items) {
            this._itemConfigMap.set(config.itemId, config);
        }
    }

    private loadGeneratorConfig(): void {
        const generatorsData = (generatorsConfig as any).default ?? generatorsConfig;
        const generators = generatorsData?.generators as GeneratorData[];
        if (!generators || !Array.isArray(generators)) {
            console.error('[ConfigManager] generators.json format error');
            return;
        }

        this._generatorConfigMap.clear();
        for (const config of generators) {
            this._generatorConfigMap.set(config.id, config);
        }
    }

    /**
     * 根据 itemId 获取物品配置
     */
    public getItemConfig(itemId: string): ItemConfig | null {
        return this._itemConfigMap.get(itemId) ?? null;
    }

    /**
     * 获取合成后的下一个 itemId
     */
    public getNextItemId(itemId: string): string | null {
        return this.getItemConfig(itemId)?.nextItemId ?? null;
    }

    /**
     * 判断某个 itemId 是否达到最大等级
     */
    public isMaxLevel(itemId: string, currentLevel: number): boolean {
        const config = this.getItemConfig(itemId);
        if (!config) {
            return false;
        }
        return currentLevel >= config.maxLevel;
    }

    /**
     * 根据 generatorId 获取发射器配置
     */
    public getGeneratorConfig(generatorId: string): GeneratorData | null {
        return this._generatorConfigMap.get(generatorId) ?? null;
    }
}
