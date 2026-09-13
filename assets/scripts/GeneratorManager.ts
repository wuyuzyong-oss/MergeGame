import { ItemData } from './ItemData';
import { ConfigManager } from './ConfigManager';
import { ResourceManager } from './resource/ResourceManager';
import { GameManager } from './GameManager';
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
     * 倍数 → 等级提升数 映射
     * x1→0级, x2→1级, x4→2级, x8→3级
     */
    private static readonly MULTIPLIER_BOOST: Record<number, number> = {
        1: 0,
        2: 1,
        4: 2,
    };

    /**
     * 点击发射器生成一个物品
     * 纯数据层：检查条件、概率滚动、返回结果数据
     * 不负责节点生成/销毁，由调用方（ItemManager）处理
     *
     * 执行顺序（生成成功才扣体力）：
     * 1. 检查空棋盘格
     * 2. 获取发射器配置
     * 3. roll概率选基础物品
     * 4. 倍数等级提升计算
     * 5. 验证新物品配置
     * 6. 选目标格子
     * 7. 消耗体力（cost × 倍数）
     * 8. 创建ItemData
     * 9. 处理发射器寿命
     *
     * @param generatorData 发射器物品数据
     * @param forceChainId  可选，强制只产出该 chainId 线路的物品（GM 一键完成订单用）
     * @returns 生成结果，失败返回 null
     */
    public generate(generatorData: ItemData, forceChainId?: string): GeneratorResult | null {
        console.log(`[Generator] Click: ${generatorData.itemId}${forceChainId ? ` (forceChain=${forceChainId})` : ''}`);

        const boardManager = GameManager.instance.boardManager;
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

        // 2. 获取发射器配置
        const generatorConfig = ConfigManager.instance.getGeneratorConfig(generatorData.itemId);
        if (!generatorConfig) {
            console.error(`[Generator] Failed: no config for ${generatorData.itemId}`);
            return null;
        }

        // 3. 根据配置概率随机选择基础产出（forceChainId 有值时只在该线路内滚动）
        const baseItemId = this.rollOutput(generatorData.itemId, generatorConfig, forceChainId);
        if (!baseItemId) {
            console.error(`[Generator] Failed: no output item for ${generatorData.itemId}${forceChainId ? ` (chain=${forceChainId})` : ''}`);
            return null;
        }
        console.log(`[Generator] Base output: ${baseItemId}`);

        // 4. 倍数等级提升计算
        const multiplier = GameManager.instance?.currentMultiplier ?? 1;
        const boostLevel = GeneratorManager.MULTIPLIER_BOOST[multiplier] ?? 0;

        const baseConfig = ConfigManager.instance.getItemConfig(baseItemId);
        if (!baseConfig) {
            console.error(`[Generator] Failed: base config not found for ${baseItemId}`);
            return null;
        }

        const baseLevel = baseConfig.level;
        let newLevel = Math.min(baseLevel + boostLevel, baseConfig.maxLevel);
        let newItemId = `${baseConfig.chainId}_lv${newLevel}`;

        // 验证提升后的物品ID在配置表存在，不存在则回退到基础物品
        let finalConfig = ConfigManager.instance.getItemConfig(newItemId);
        if (!finalConfig) {
            console.warn(`[Generator] boosted item ${newItemId} not found, fallback to ${baseItemId}`);
            newItemId = baseItemId;
            newLevel = baseLevel;
            finalConfig = baseConfig;
        }

        if (boostLevel > 0) {
            console.log(`[Generator] Multiplier x${multiplier}: ${baseItemId}(Lv${baseLevel}) -> ${newItemId}(Lv${newLevel})`);
        }

        // 5. 选距离发射器最近的空格子作为目标（就近发射）
        const genCol = generatorData.col;
        const genRow = generatorData.row;
        emptyCells.sort((a, b) => {
            const distA = Math.abs(a.col - genCol) + Math.abs(a.row - genRow);
            const distB = Math.abs(b.col - genCol) + Math.abs(b.row - genRow);
            return distA - distB;
        });
        const targetCell = emptyCells[0];

        // 6. 消耗体力（cost × 倍数）—— 所有前置检查通过后才扣
        const cost = generatorConfig.cost ?? 1;
        const totalCost = cost * multiplier;
        if (!ResourceManager.instance.consumeEnergy(totalCost)) {
            console.log(`[Generator] not enough energy (need ${totalCost})`);
            return null;
        }
        console.log(`[Generator] Energy -${totalCost} (cost=${cost} × multiplier=${multiplier})`);

        // 7. 创建对应 ItemData
        const outputItemData = new ItemData({
            itemId: finalConfig.itemId,
            chainId: finalConfig.chainId,
            level: finalConfig.level,
            maxLevel: finalConfig.maxLevel,
        });

        // 8. 处理发射器寿命（不受倍数影响，每次点击消耗1次）
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
     * 根据概率滚动产出
     * @param forceChainId 可选，仅在该 chainId 线路的产出中滚动（权重重归一化）
     */
    private rollOutput(generatorId: string, config: import('./generator/GeneratorData').GeneratorData | null, forceChainId?: string): string | null {
        if (!config || !config.outputs || config.outputs.length === 0) {
            return null;
        }

        // 如果指定了线路，过滤出该线路的产出
        let outputs = config.outputs;
        if (forceChainId) {
            outputs = outputs.filter(o => {
                const itemConfig = ConfigManager.instance.getItemConfig(o.itemId);
                return itemConfig?.chainId === forceChainId;
            });
            if (outputs.length === 0) {
                console.warn(`[Generator] No output for chain ${forceChainId} in ${generatorId}`);
                return null;
            }
        }

        // 基于（可能已过滤的）产出重新计算总权重，保证权重归一化
        const totalRate = outputs.reduce((sum, o) => sum + o.rate, 0);
        if (totalRate <= 0) {
            return outputs[outputs.length - 1].itemId;
        }

        const roll = Math.random() * totalRate;
        console.log(`[Generator] Roll: ${roll.toFixed(2)} / ${totalRate}${forceChainId ? ` (chain=${forceChainId})` : ''}`);

        let cumulative = 0;
        for (const output of outputs) {
            cumulative += output.rate;
            if (roll < cumulative) {
                return output.itemId;
            }
        }

        // 兜底返回最后一个
        return outputs[outputs.length - 1].itemId;
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
