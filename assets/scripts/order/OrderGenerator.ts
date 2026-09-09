import { OrderData } from './OrderData';
import { OrderItem } from './OrderItem';
import { MERGE_LINE_WEIGHT, LINE_LEVEL_WEIGHT, ORDER_GLOBAL_CONFIG, ITEM_VALUE_RANGE } from './OrderConfig';

/**
 * 订单生成器
 * 根据当前倍率，按配置的概率生成订单
 *
 * 生成流程：
 * 1. 随机决定订单需求物品数量（1~3个）
 * 2. 对每个需求物品，从7条线路中按「线路抽取权重」随机选一条线路
 * 3. 选中线路后，根据当前倍率（x1/x2/x4），按该线路的等级权重随机选出物品等级
 * 4. 组合成订单需求（如 bp_c1_lv3、jam_c1_lv5 等）
 * 5. 计算订单奖励金币
 */
export class OrderGenerator {
    /**
     * 生成一个订单
     * @param multiplier 当前倍率（1 | 2 | 4）
     * @param orderId 订单ID（由外部传入，保证唯一）
     * @param npcId NPC ID（由外部传入，保证同一批订单NPC不重复）
     * @returns 订单数据
     */
    public static generateOrder(
        multiplier: 1 | 2 | 4,
        orderId: string,
        npcId: string
    ): OrderData {
        // 1. 随机决定订单需求物品数量
        const requireCount = this.randomInt(
            ORDER_GLOBAL_CONFIG.minRequireCount,
            ORDER_GLOBAL_CONFIG.maxRequireCount
        );

        // 2. 逐个生成需求物品（物品不重复，每个数量固定为1）
        const items: OrderItem[] = [];
        const usedItemIds = new Set<string>();
        const maxRetries = 20; // 最大重试次数，避免死循环

        for (let i = 0; i < requireCount; i++) {
            let itemId = '';
            let retries = 0;

            // 重试直到生成不重复的物品，或达到最大重试次数
            while (retries < maxRetries) {
                // 2.1 随机选线路
                const lineId = this.randomPickLine();
                if (!lineId) {
                    console.warn('[OrderGenerator] 没有可用线路');
                    break;
                }

                // 2.2 选中线路后，按当前倍率随机选等级
                const level = this.randomPickLevel(lineId, multiplier);
                if (level <= 0) {
                    console.warn(`[OrderGenerator] 线路 ${lineId} 在倍率 x${multiplier} 下没有可用等级`);
                    retries++;
                    continue;
                }

                // 2.3 组合成 itemId（格式：{lineId}_lv{level}）
                const candidateId = `${lineId}_lv${level}`;

                // 2.4 检查是否重复
                if (!usedItemIds.has(candidateId)) {
                    itemId = candidateId;
                    usedItemIds.add(candidateId);
                    break;
                }

                retries++;
            }

            if (itemId) {
                // 每个物品数量固定为1
                items.push({ itemId, count: 1 });
            }
        }

        // 3. 计算订单奖励金币
        const reward = this.calculateReward(items);

        // 4. 组装订单数据
        return new OrderData({
            id: orderId,
            npcId,
            items,
            reward,
        });
    }

    /**
     * 按权重随机选一条线路
     * @returns 线路ID
     */
    private static randomPickLine(): string {
        const totalWeight = MERGE_LINE_WEIGHT.reduce((sum, item) => sum + item.weight, 0);
        if (totalWeight <= 0) return '';

        const rand = Math.random() * totalWeight;
        let current = 0;
        for (const item of MERGE_LINE_WEIGHT) {
            current += item.weight;
            if (rand <= current) {
                return item.lineId;
            }
        }
        return MERGE_LINE_WEIGHT[0].lineId;
    }

    /**
     * 选中线路后，按当前倍率随机选等级
     * @param lineId 线路ID
     * @param multiplier 当前倍率
     * @returns 等级（0表示没有可用等级）
     */
    private static randomPickLevel(lineId: string, multiplier: 1 | 2 | 4): number {
        const lineConfig = LINE_LEVEL_WEIGHT[lineId];
        if (!lineConfig) {
            console.warn(`[OrderGenerator] 线路 ${lineId} 没有配置`);
            return 0;
        }

        // 根据倍率取对应的等级权重表
        const levelWeight = multiplier === 1 ? lineConfig.x1 :
                            multiplier === 2 ? lineConfig.x2 :
                            lineConfig.x4;

        // 计算总权重
        const levels = Object.keys(levelWeight).map(Number);
        const totalWeight = levels.reduce((sum, lv) => sum + (levelWeight[lv] || 0), 0);
        if (totalWeight <= 0) return 0;

        // 权重随机抽取
        const rand = Math.random() * totalWeight;
        let current = 0;
        for (const lv of levels) {
            current += levelWeight[lv] || 0;
            if (rand <= current) {
                return lv;
            }
        }
        return levels[0];
    }

    /**
     * 计算订单奖励金币
     * 每个需求物品按等级从价值范围内随机取一个价值，乘以需求数量，然后求和
     * @param items 订单需求物品列表
     * @returns 奖励金币数
     */
    private static calculateReward(items: OrderItem[]): number {
        let totalReward = 0;
        for (const item of items) {
            // 从 itemId 中解析等级（格式：{lineId}_lv{level}）
            const match = item.itemId.match(/_lv(\d+)$/);
            if (match) {
                const level = parseInt(match[1], 10);
                const valueRange = ITEM_VALUE_RANGE[level];
                if (valueRange) {
                    // 在范围内随机取一个价值
                    const itemValue = this.randomInt(valueRange.min, valueRange.max);
                    totalReward += itemValue * item.count;
                }
            }
        }
        return totalReward;
    }

    /**
     * [min, max] 整数随机
     */
    private static randomInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}
