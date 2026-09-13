import { Node, Vec3, tween } from 'cc';
import { ItemManager } from '../ItemManager';
import { OrderManager } from '../order/OrderManager';
import { EventManager } from '../core/EventManager';
import { getGameContext } from '../core/GameContext';
import { AudioManager } from '../AudioManager';

/**
 * GM 模拟器：三个原子操作
 *
 * 每个操作都会触发与真人操作一致的动画特效，并在完成后通过回调通知调用者。
 * - simulateFire：模拟点击发射器发射物品（含选中特效 + 物品 spawn 缩放动画 + 发射音效）
 * - simulateMerge：模拟拖动物品到目标格合成（含位移动画 + 爆炸特效 + 合成缩放动画 + 合成音效）
 * - simulateOrderComplete：模拟点击订单完成按钮（含物品飞行 + 缩小消失 + 卡片消失 + 金币散落 + 完成音效）
 *
 * 设计原则：不派发真实触摸事件，而是直接调用游戏内部逻辑方法 + 补间动画模拟视觉，
 * 既能触发完整动画链路，又避免 EventTouch 构造在不同平台下的不稳定性。
 */
export class GMSimulator {
    /** 发射后等待 spawn 动画结束的延迟（毫秒），spawn 缩放动画为 0.15s */
    private static readonly FIRE_ANIM_DELAY = 200;

    /** 合成移动动画时长（秒），与 ItemManager 内部移动动画一致 */
    private static readonly MERGE_MOVE_DURATION = 0.15;

    /** 合成后等待新物品 spawn 动画结束的延迟（毫秒） */
    private static readonly MERGE_ANIM_DELAY = 200;

    /** 合成操作超时保护（毫秒），超时未收到 ITEM_MERGED 视为失败 */
    private static readonly MERGE_TIMEOUT = 3000;

    /** 订单完成超时保护（毫秒），超时未收到 ORDER_CHANGED 视为失败 */
    private static readonly ORDER_COMPLETE_TIMEOUT = 12000;

    /** 拖拽时抬起的 Z 轴偏移，与 Item.dragZOffset 一致 */
    private static readonly DRAG_Z_OFFSET = 10;

    // ==================== 原子操作 1：发射 ====================

    /**
     * 模拟点击发射器发射一个物品
     *
     * 流程：选中发射器（显示选中特效）→ 调用 fireGenerator（可锁定线路）→
     *       物品以 scale 0.5→1 动画出现 + 播放发射音效 → 延迟后回调
     *
     * @param generatorNode 发射器物品节点
     * @param forceChainId  可选，强制只产出该 chainId 线路的物品
     * @param callback      完成回调，success=true 表示发射成功
     */
    public static simulateFire(
        generatorNode: Node,
        forceChainId: string | null,
        callback: (success: boolean) => void
    ): void {
        if (!generatorNode || !generatorNode.isValid) {
            console.warn('[GMSimulator] simulateFire: generatorNode 无效');
            callback(false);
            return;
        }

        const itemManager = ItemManager.instance;

        // 选中发射器（显示选中特效，与真人点击一致；已选中则跳过）
        if (!itemManager.isSelected(generatorNode)) {
            itemManager.selectItem(generatorNode);
        }

        // 发射（forceChainId 有值时只产出对应线路物品）
        const success = itemManager.fireGenerator(generatorNode, forceChainId ?? undefined);
        if (!success) {
            // 体力不足 / 棋盘已满 / 发射器寿命耗尽
            callback(false);
            return;
        }

        // 等待 spawn 缩放动画（0.15s）结束后回调
        setTimeout(() => callback(true), GMSimulator.FIRE_ANIM_DELAY);
    }

    // ==================== 原子操作 2：合成 ====================

    /**
     * 模拟拖动物品到目标格子进行合成
     *
     * 流程：抬起物品（z 轴 + 顶层）→ tween 移动到目标格（模拟拖拽位移）→
     *       调用 handleItemDrop 触发合成（爆炸特效 + 两物品 scale→0 + 新物品 scale 0.7→1 + 合成音效）→
     *       监听 ITEM_MERGED 事件，收到后延迟回调
     *
     * 注意：调用方需保证 (itemNode, targetCol, targetRow) 满足合成条件（同 chain、同 level、非满级）。
     *
     * @param itemNode  被拖动的物品节点
     * @param targetCol 目标格子列（合成后新物品停留在此格）
     * @param targetRow 目标格子行
     * @param callback  完成回调，success=true 表示合成成功
     */
    public static simulateMerge(
        itemNode: Node,
        targetCol: number,
        targetRow: number,
        callback: (success: boolean) => void
    ): void {
        const boardManager = getGameContext()?.boardManager ?? null;
        if (!boardManager) {
            console.warn('[GMSimulator] simulateMerge: BoardManager 未初始化');
            callback(false);
            return;
        }

        if (!itemNode || !itemNode.isValid) {
            console.warn('[GMSimulator] simulateMerge: itemNode 无效');
            callback(false);
            return;
        }

        const comp = itemNode.getComponent('Item') as unknown as { data: { col: number; row: number } | null } | null;
        const itemData = comp?.data;
        if (!itemData) {
            console.warn('[GMSimulator] simulateMerge: itemNode 无 ItemData');
            callback(false);
            return;
        }

        const originCol = itemData.col;
        const originRow = itemData.row;
        const targetCell = boardManager.getCell(targetCol, targetRow);
        if (!targetCell) {
            console.warn(`[GMSimulator] simulateMerge: 目标格子 (${targetCol},${targetRow}) 无效`);
            callback(false);
            return;
        }

        const targetWorldPos = boardManager.getCellWorldPos(targetCol, targetRow);
        if (!targetWorldPos) {
            console.warn('[GMSimulator] simulateMerge: 无法获取目标格世界坐标');
            callback(false);
            return;
        }

        const boardRoot = itemNode.parent;
        if (!boardRoot) {
            console.warn('[GMSimulator] simulateMerge: itemNode 无父节点');
            callback(false);
            return;
        }

        // 抬起物品：提升 siblingIndex 到顶层 + 抬高 z 轴（模拟拖拽抬起效果）
        const originalSiblingIndex = itemNode.getSiblingIndex();
        itemNode.setSiblingIndex(boardRoot.children.length - 1);
        const originZ = itemNode.position.z;
        const raisedZ = originZ + GMSimulator.DRAG_Z_OFFSET;
        itemNode.setPosition(itemNode.position.x, itemNode.position.y, raisedZ);

        // 计算目标格在 boardRoot 下的本地坐标（与 ItemManager.worldToLocal 逻辑一致，保留抬起的 z）
        const rootWorldPos = boardRoot.getWorldPosition();
        const targetLocalPos = new Vec3(
            targetWorldPos.x - rootWorldPos.x,
            targetWorldPos.y - rootWorldPos.y,
            raisedZ
        );

        // 合成完成检测：监听 ITEM_MERGED 事件 + 超时保护
        let settled = false;
        const onMerged = (): void => {
            if (settled) return;
            settled = true;
            EventManager.instance.off(EventManager.ITEM_MERGED, onMerged);
            clearTimeout(timeoutId);
            // 等待新物品 spawn 缩放动画（0.15s）结束后回调
            setTimeout(() => callback(true), GMSimulator.MERGE_ANIM_DELAY);
        };
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            EventManager.instance.off(EventManager.ITEM_MERGED, onMerged);
            console.warn('[GMSimulator] simulateMerge: 合成超时');
            callback(false);
        }, GMSimulator.MERGE_TIMEOUT);

        EventManager.instance.on(EventManager.ITEM_MERGED, onMerged);

        // tween 移动到目标格（模拟拖拽位移），完成后触发落点合成逻辑
        tween(itemNode)
            .to(GMSimulator.MERGE_MOVE_DURATION, { position: targetLocalPos })
            .call(() => {
                if (!itemNode.isValid) {
                    if (!settled) {
                        settled = true;
                        EventManager.instance.off(EventManager.ITEM_MERGED, onMerged);
                        clearTimeout(timeoutId);
                        callback(false);
                    }
                    return;
                }
                // 恢复 z 轴（合成动画会销毁节点，此处主要保证非合成情况下视觉正确）
                itemNode.setPosition(itemNode.position.x, itemNode.position.y, originZ);
                itemNode.setSiblingIndex(originalSiblingIndex);
                // 触发落点逻辑：目标格有同 chain 同 level 物品 → 合成
                ItemManager.instance.handleItemDrop(itemNode, originCol, originRow, targetCell);
            })
            .start();
    }

    // ==================== 原子操作 3：完成订单 ====================

    /**
     * 模拟点击订单完成按钮
     *
     * 流程：调用 OrderManager.completeOrder → 触发完整动画链
     *       （物品飞向订单卡片 → 物品缩小消失 → 卡片缩放消失 + 金币散落飞行 → 1.5s 后 finalize）→
     *       监听 ORDER_CHANGED 事件并验证订单确实已移除，收到后回调
     *
     * @param orderId  订单 ID
     * @param callback 完成回调，success=true 表示订单已完成并被替换
     */
    public static simulateOrderComplete(
        orderId: string,
        callback: (success: boolean) => void
    ): void {
        const orderManager = OrderManager.instance;

        // 启动完成动画链（发射后不管，立即返回 true）
        const started = orderManager.completeOrder(orderId);
        if (!started) {
            console.warn(`[GMSimulator] simulateOrderComplete: 无法启动订单 ${orderId} 的完成流程`);
            callback(false);
            return;
        }

        // 播放点击完成按钮音效（与真人点击 OrderCard 完成按钮一致）
        // 自动完成路径直接调用 completeOrder，不经过 OrderCard.onCompleteClick，需在此补上，否则全自动模式会少这个音效
        AudioManager.instance.playSFX(AudioManager.SFX_ORDER_COMPLETE);

        // 完成检测：监听 ORDER_CHANGED 事件，并验证订单确实已从列表移除
        let settled = false;
        const onOrderChanged = (): void => {
            if (settled) return;
            // 验证订单确实已被移除（避免被其他来源的 ORDER_CHANGED 误触发）
            const stillExists = orderManager.getCurrentOrders().some(o => o.id === orderId);
            if (stillExists) {
                return; // 不是目标订单的完成事件，继续等待
            }
            settled = true;
            EventManager.instance.off(EventManager.ORDER_CHANGED, onOrderChanged);
            clearTimeout(timeoutId);
            callback(true);
        };
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            EventManager.instance.off(EventManager.ORDER_CHANGED, onOrderChanged);
            console.warn(`[GMSimulator] simulateOrderComplete: 订单 ${orderId} 完成超时`);
            callback(false);
        }, GMSimulator.ORDER_COMPLETE_TIMEOUT);

        EventManager.instance.on(EventManager.ORDER_CHANGED, onOrderChanged);
    }
}
