import { ItemData } from './ItemData';
import { ConfigManager } from './ConfigManager';
import { ResourceManager } from './resource/ResourceManager';
import { getGameContext } from './core/GameContext';
import { Cell } from './Cell';
import { BoardManager } from './BoardManager';
import type { GeneratorResult } from './generator/GeneratorData';

/**
 * 发射器管理器
 * 负责根据发射器配置概率生成物品
 */
export class GeneratorManager {
    private static _instance: GeneratorManager = new GeneratorManager();
    public static get instance(): GeneratorManager {
        return GeneratorManager._instance;
    }

    /**
     * 点击发射器生成一个物品
     * 纯数据层：检查条件、概率滚动、返回结果数据
     * 不负责节点生成/销毁，由调用方（ItemManager）处理
     * @param generatorData 发射器物品数据
     * @returns 生成结果，失败返回 null
     */
    public generate(generatorData: ItemData): GeneratorResult | null {
        console.log(`[Generator] Click: ${generatorData.itemId}`);

        const boardManager = getGameContext()?.boardManager ?? null;
        if (!boardManager) {
            console.error('[Generator] Failed: BoardManager not found');
            return null;
        }

        // 1. 检查是否存在空棋盘格
        const emptyCells = this.getEmptyCells(boardManager);
        if (emptyCells.length === 0) {
            console.log('[Generator] Failed: board full');
            return null;
        }

        // 2. 检查体力
        const generatorConfig = ConfigManager.instance.getGeneratorConfig(generatorData.itemId);
        const cost = generatorConfig?.cost ?? 1;
        if (!ResourceManager.instance.consumeEnergy(cost)) {
            console.log('[Generator] not enough energy');
            return null;
        }

        // 3. 根据配置概率随机选择产物
        const outputItemId = this.rollOutput(generatorData.itemId, generatorConfig);
        if (!outputItemId) {
            console.error(`[Generator] Failed: no output item for ${generatorData.itemId}`);
            return null;
        }
        console.log(`[Generator] Output: ${outputItemId}`);

        // 4. 创建对应 ItemData
        const config = ConfigManager.instance.getItemConfig(outputItemId);
        if (!config) {
            console.error(`[Generator] Failed: config not found for ${outputItemId}`);
            return null;
        }

        const outputItemData = new ItemData({
            itemId: config.itemId,
            chainId: config.chainId,
            level: config.level,
            maxLevel: config.maxLevel,
        });

        // 5. 找到空棋盘格
        const targetCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];

        // 6. 处理发射器寿命
        let generatorExhausted = false;
        if (generatorConfig && typeof generatorConfig.life === 'number') {
            generatorData.generatorLife--;
            if (generatorData.generatorLife <= 0) {
                generatorExhausted = true;
                console.log(`[Generator] ${generatorData.itemId} life exhausted`);
            }
        }

        return {
            outputItemData,
            targetCol: targetCell.col,
            targetRow: targetCell.row,
            generatorExhausted,
        };
    }

    /**
     * 根据概率滚动产物
     */
    private rollOutput(generatorId: string, config: import('./generator/GeneratorData').GeneratorData | null): string | null {
        if (!config || !config.outputs || config.outputs.length === 0) {
            return null;
        }

        const roll = Math.random() * 100;
        console.log(`[Generator] Roll: ${roll.toFixed(2)}`);

        let cumulative = 0;
        for (const output of config.outputs) {
            cumulative += output.rate;
            if (roll < cumulative) {
                return output.itemId;
            }
        }

        // 兜底返回最后一个
        return config.outputs[config.outputs.length - 1].itemId;
    }

    /**
     * 获取所有空棋盘格
     */
    private getEmptyCells(boardManager: BoardManager): Cell[] {
        const emptyCells: Cell[] = [];
        for (let col = 0; col < BoardManager.COLS; col++) {
            for (let row = 0; row < BoardManager.ROWS; row++) {
                const cell = boardManager.getCell(col, row);
                if (cell && cell.isEmpty()) {
                    emptyCells.push(cell);
                }
            }
        }
        return emptyCells;
    }
}
