import type { ItemData } from '../ItemData';

/**
 * 发射器产物配置
 */
export interface GeneratorOutput {
    itemId: string;
    rate: number;
}

/**
 * 发射器配置数据
 * 对应 generators.json 中的单个发射器
 */
export interface GeneratorData {
    id: string;
    cost: number;
    life?: number;
    outputs: GeneratorOutput[];
}

/**
 * 发射器生成结果
 * GeneratorManager 只负责返回数据，不操作节点
 */
export interface GeneratorResult {
    /** 生成的物品数据 */
    outputItemData: ItemData;
    /** 目标棋盘列 */
    targetCol: number;
    /** 目标棋盘行 */
    targetRow: number;
    /** 发射器寿命是否耗尽 */
    generatorExhausted: boolean;
}
