import { ItemData } from './ItemData';
import { ConfigManager } from './ConfigManager';

/**
 * 合成管理器
 * 负责判断与执行两个物品的合成逻辑
 */
export class MergeManager {
    private static _instance: MergeManager = new MergeManager();
    public static get instance(): MergeManager {
        return MergeManager._instance;
    }

    /**
     * 判断两个物品能否合成
     * 条件：
     * 1. chainId 相同
     * 2. level 相同
     * 3. 当前等级不是最高等级
     * 4. 不是同一个实例
     */
    public canMerge(a: ItemData, b: ItemData): boolean {
        if (a === b) {
            console.log('[Merge] Cannot merge: same instance');
            return false;
        }
        if (a.chainId !== b.chainId) {
            console.log('[Merge] Cannot merge: different chainId');
            return false;
        }
        if (a.level !== b.level) {
            console.log('[Merge] Cannot merge: different level');
            return false;
        }
        if (a.isMaxLevel() || b.isMaxLevel()) {
            console.log('[Merge] Cannot merge: already max level');
            return false;
        }

        const nextA = ConfigManager.instance.getNextItemId(a.itemId);
        const nextB = ConfigManager.instance.getNextItemId(b.itemId);
        if (!nextA || !nextB) {
            console.log('[Merge] Cannot merge: no next item defined in config');
            return false;
        }

        console.log(`[Merge] Can merge: ${a.itemId} + ${b.itemId}`);
        return true;
    }

    /**
     * 执行合成并返回合成后的下一级 itemId
     * 返回 null 表示无法合成
     */
    public merge(a: ItemData, b: ItemData): string | null {
        if (!this.canMerge(a, b)) {
            return null;
        }

        // 两个物品 chainId/level 相同，取其中一个的 nextItemId 即可
        const nextItemId = ConfigManager.instance.getNextItemId(a.itemId);
        console.log(`[Merge] Merge result: ${a.itemId} + ${b.itemId} -> ${nextItemId}`);
        return nextItemId;
    }
}
