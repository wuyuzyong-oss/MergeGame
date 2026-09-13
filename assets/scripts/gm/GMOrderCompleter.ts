import { Node } from 'cc';
import { GMSimulator } from './GMSimulator';
import { OrderManager } from '../order/OrderManager';
import { BoardManager } from '../BoardManager';
import { ConfigManager } from '../ConfigManager';
import { GameManager } from '../GameManager';
import { getGameContext } from '../core/GameContext';
import { ItemData } from '../ItemData';

/**
 * 订单完成结果回调
 * @param success 是否成功
 * @param message 结果说明（失败原因或成功提示）
 */
export type OrderCompleteCallback = (success: boolean, message: string) => void;

/**
 * 单个需求物品的生产目标
 */
interface OrderTarget {
    /** 目标物品 ID，如 bp_c1_lv3 */
    itemId: string;
    /** 需求数量 */
    count: number;
    /** 所属合成链 ID，如 bp_c1 */
    chainId: string;
    /** 目标等级 */
    level: number;
}

/**
 * 可合成对：把 nodeA 拖到 (colB, rowB) 触发合成
 */
interface MergePair {
    nodeA: Node;
    colB: number;
    rowB: number;
}

/**
 * GM 订单完成编排器
 *
 * 负责把「一键完成订单」拆解为一系列原子操作（发射 / 合成 / 完成订单），
 * 并按智能策略编排执行顺序：
 * 1. 分析订单需求，按目标等级降序排列（先做高等级，避免低等级产物被合成消耗）
 * 2. 对每个需求物品循环：优先合成已有物品，无可合成对时按锁定线路发射
 * 3. 根据目标等级智能切换倍率（lv1→x1, lv2→x2, lv3+→x4）
 * 4. 全部物品就绪后触发订单完成动画
 *
 * 所有耗时操作都通过 GMSimulator 的回调串联，保证动画完整播放、节奏紧凑。
 */
export class GMOrderCompleter {
    /** 单个物品生产的最大迭代次数，防止死循环 */
    private static readonly MAX_ITERATIONS = 200;

    // ==================== 对外主入口 ====================

    /**
     * 一键完成指定订单
     *
     * @param orderId      订单 ID
     * @param autoComplete true=自动模式（物品齐全后自动触发完成动画）；
     *                     false=手动模式（物品齐全即结束，由玩家手动点击游戏内完成按钮）
     * @param callback     完成回调，success=true 表示流程成功结束
     */
    public static completeOrder(orderId: string, autoComplete: boolean, callback: OrderCompleteCallback): void {
        const orderManager = OrderManager.instance;
        const order = orderManager.getCurrentOrders().find(o => o.id === orderId);
        if (!order) {
            callback(false, '订单不存在');
            return;
        }

        const boardManager = getGameContext()?.boardManager ?? null;
        if (!boardManager) {
            callback(false, 'BoardManager 未初始化');
            return;
        }

        // 按目标等级降序排列需求物品（先做高等级，避免低等级产物被合成消耗）
        const targets: OrderTarget[] = order.items
            .map(req => ({
                itemId: req.itemId,
                count: req.count,
                chainId: GMOrderCompleter.extractChainId(req.itemId),
                level: GMOrderCompleter.extractLevel(req.itemId),
            }))
            .sort((a, b) => b.level - a.level);

        console.log(`[GMOrderCompleter] 开始完成订单 ${orderId}，需求：${targets.map(t => t.itemId).join(', ')}`);

        // 依次生产每个需求物品，全部就绪后按模式处理
        GMOrderCompleter.produceTargetsSequentially(targets, 0, boardManager, (success, message) => {
            if (!success) {
                callback(false, message);
                return;
            }
            // 手动模式：物品齐全即结束，由玩家手动点击游戏内完成按钮
            if (!autoComplete) {
                callback(true, '物品已备齐，请手动点击订单完成按钮');
                return;
            }
            // 自动模式：物品齐全后自动触发订单完成动画
            GMSimulator.simulateOrderComplete(orderId, done => {
                callback(done, done ? '订单已完成' : '订单完成超时');
            });
        });
    }

    // ==================== 生产编排 ====================

    /**
     * 依次生产需求物品列表
     */
    private static produceTargetsSequentially(
        targets: OrderTarget[],
        index: number,
        boardManager: BoardManager,
        callback: (success: boolean, message: string) => void
    ): void {
        if (index >= targets.length) {
            callback(true, '');
            return;
        }

        const target = targets[index];
        GMOrderCompleter.produceItem(
            target,
            0,
            boardManager,
            (success, message) => {
                if (!success) {
                    callback(false, message);
                    return;
                }
                GMOrderCompleter.produceTargetsSequentially(targets, index + 1, boardManager, callback);
            }
        );
    }

    /**
     * 生产单个需求物品（递归循环：合成优先，否则发射）
     *
     * @param target     生产目标
     * @param iteration  当前迭代次数（用于死循环保护）
     * @param boardManager 棋盘管理器
     * @param callback   完成回调
     */
    private static produceItem(
        target: OrderTarget,
        iteration: number,
        boardManager: BoardManager,
        callback: (success: boolean, message: string) => void
    ): void {
        // 迭代上限保护
        if (iteration > GMOrderCompleter.MAX_ITERATIONS) {
            callback(false, '超过最大迭代次数');
            return;
        }

        // 1. 检查棋盘上目标物品数量是否已满足
        const currentCount = GMOrderCompleter.countOnBoard(target.itemId, boardManager);
        if (currentCount >= target.count) {
            callback(true, '');
            return;
        }

        // 2. 查找对应线路的发射器
        const generatorNode = GMOrderCompleter.findGeneratorForChain(target.chainId);
        if (!generatorNode) {
            callback(false, `无对应发射器（${target.chainId}）`);
            return;
        }

        // 3. 设置智能倍率（lv1→x1, lv2→x2, lv3+→x4）
        const multiplier = GMOrderCompleter.getOptimalMultiplier(target.level);
        GameManager.instance?.setMultiplier(multiplier);

        // 4. 优先查找可合成对（减少发射次数、节省体力）
        const pair = GMOrderCompleter.findMergeablePair(target.chainId, target.level);
        if (pair) {
            GMSimulator.simulateMerge(pair.nodeA, pair.colB, pair.rowB, merged => {
                if (!merged) {
                    callback(false, '合成失败');
                    return;
                }
                GMOrderCompleter.produceItem(target, iteration + 1, boardManager, callback);
            });
            return;
        }

        // 5. 无可合成对，锁定线路发射一个物品
        GMSimulator.simulateFire(generatorNode, target.chainId, fired => {
            if (!fired) {
                callback(false, '发射失败（体力不足或棋盘已满）');
                return;
            }
            GMOrderCompleter.produceItem(target, iteration + 1, boardManager, callback);
        });
    }

    // ==================== 智能倍率 ====================

    /**
     * 根据目标等级选择最优倍率
     *
     * 倍率提升机制：x1→+0 级, x2→+1 级, x4→+2 级。
     * - lv1 目标：x1，发射基础物品即命中（约 71%）
     * - lv2 目标：x2，基础 lv1 提升为 lv2（约 71%）
     * - lv3+ 目标：x4，基础 lv1 提升为 lv3（约 71%），能量效率最优
     *
     * @param targetLevel 目标等级
     * @returns 倍率（1 | 2 | 4）
     */
    private static getOptimalMultiplier(targetLevel: number): number {
        if (targetLevel <= 1) {
            return 1;
        }
        if (targetLevel === 2) {
            return 2;
        }
        return 4;
    }

    // ==================== 棋盘查询辅助 ====================

    /**
     * 统计棋盘上指定 itemId 的数量
     */
    private static countOnBoard(itemId: string, boardManager: BoardManager): number {
        let count = 0;
        for (let col = 0; col < BoardManager.COLS; col++) {
            for (let row = 0; row < BoardManager.ROWS; row++) {
                const item = boardManager.getItem(col, row);
                if (item && item.itemId === itemId) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * 查找能产出指定线路物品的发射器节点
     *
     * 遍历棋盘所有物品节点，找到 isGenerator 且其 outputs 中包含该 chainId 物品的发射器。
     * 若有多个匹配，返回第一个。
     *
     * @param chainId 目标线路 ID
     * @returns 发射器节点，找不到返回 null
     */
    private static findGeneratorForChain(chainId: string): Node | null {
        const boardRoot = getGameContext()?.boardPanel ?? null;
        if (!boardRoot) {
            return null;
        }

        for (const child of boardRoot.children) {
            const data = GMOrderCompleter.getItemData(child);
            if (!data || !data.isGenerator) {
                continue;
            }
            const genConfig = ConfigManager.instance.getGeneratorConfig(data.itemId);
            if (!genConfig || !genConfig.outputs) {
                continue;
            }
            const hasChain = genConfig.outputs.some(o => {
                const itemConfig = ConfigManager.instance.getItemConfig(o.itemId);
                return itemConfig?.chainId === chainId;
            });
            if (hasChain) {
                return child;
            }
        }
        return null;
    }

    /**
     * 查找可合成对：同 chainId、同 level、level < targetLevel、非满级、非发射器
     *
     * 按 level 分组，选 level 最高且有 2+ 个物品的组（优先合成高等级，加快逼近目标）。
     * 返回该组中前两个物品：把第一个拖到第二个所在格子触发合成。
     *
     * @param chainId     目标线路 ID
     * @param targetLevel 目标等级（只合成低于此等级的物品，避免消耗目标产物）
     * @returns 可合成对，找不到返回 null
     */
    private static findMergeablePair(chainId: string, targetLevel: number): MergePair | null {
        const boardRoot = getGameContext()?.boardPanel ?? null;
        if (!boardRoot) {
            return null;
        }

        // 按 level 分组收集可合成物品节点
        const levelGroups: Map<number, Node[]> = new Map();
        for (const child of boardRoot.children) {
            const data = GMOrderCompleter.getItemData(child);
            if (!data || data.isGenerator) {
                continue;
            }
            if (data.chainId !== chainId) {
                continue;
            }
            if (data.level >= targetLevel) {
                continue; // 不合成目标等级及以上的物品
            }
            if (data.isMaxLevel()) {
                continue; // 满级不可合成
            }
            const group = levelGroups.get(data.level);
            if (group) {
                group.push(child);
            } else {
                levelGroups.set(data.level, [child]);
            }
        }

        // 选 level 最高且有 2+ 个物品的组
        let bestLevel = -1;
        let bestGroup: Node[] | null = null;
        levelGroups.forEach((nodes, level) => {
            if (nodes.length >= 2 && level > bestLevel) {
                bestLevel = level;
                bestGroup = nodes;
            }
        });

        if (!bestGroup || bestGroup.length < 2) {
            return null;
        }

        const nodeA = bestGroup[0];
        const dataB = GMOrderCompleter.getItemData(bestGroup[1]);
        if (!dataB) {
            return null;
        }
        return { nodeA, colB: dataB.col, rowB: dataB.row };
    }

    /**
     * 获取节点上 Item 组件绑定的 ItemData
     * 使用字符串组件名，避免直接 import Item 造成循环依赖
     */
    private static getItemData(node: Node): ItemData | null {
        const comp = node.getComponent('Item') as unknown as { data: ItemData | null } | null;
        return comp?.data ?? null;
    }

    // ==================== itemId 解析 ====================

    /**
     * 从 itemId 解析 chainId（去掉 _lv{n} 后缀）
     * 例：bp_c1_lv3 → bp_c1
     */
    private static extractChainId(itemId: string): string {
        return itemId.replace(/_lv\d+$/, '');
    }

    /**
     * 从 itemId 解析等级
     * 例：bp_c1_lv3 → 3
     */
    private static extractLevel(itemId: string): number {
        const match = itemId.match(/_lv(\d+)$/);
        return match ? parseInt(match[1], 10) : 1;
    }
}
