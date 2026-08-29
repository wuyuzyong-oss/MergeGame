import { Vec3, Node, tween } from 'cc';
import * as ordersConfig from '../../configs/orders.json';
import { OrderData } from './OrderData';
import type { OrderItem } from './OrderItem';
import { BoardManager } from '../BoardManager';
import { ItemManager } from '../ItemManager';
import { ResourceManager } from '../resource/ResourceManager';
import { ItemData } from '../ItemData';
import { getGameContext } from '../core/GameContext';
import { EventManager } from '../core/EventManager';

/**
 * 订单状态
 */
export enum OrderStatus {
    UNFINISHED = 'unfinished',
    PARTIAL = 'partial',
    COMPLETE = 'complete',
}

/**
 * 单个订单的检测结果
 */
export interface OrderCheckResult {
    order: OrderData;
    status: OrderStatus;
    progress: string;
}

/**
 * 订单管理器
 * 负责订单的加载、检测、完成与刷新
 */
export class OrderManager {
    private static _instance: OrderManager = new OrderManager();
    public static get instance(): OrderManager {
        return OrderManager._instance;
    }

    private _allOrders: OrderData[] = [];
    private _currentOrders: OrderData[] = [];

    /**
     * 初始化订单系统
     */
    public init(): void {
        this.loadOrders();
        this.generateCurrentOrders(5);
        console.log('[OrderManager] initialized with orders:', this._currentOrders.map(o => o.id));
    }

    /**
     * 获取当前订单列表
     */
    public getCurrentOrders(): OrderData[] {
        return this._currentOrders;
    }

    /**
     * 检测所有当前订单的完成状态
     */
    public checkOrders(): OrderCheckResult[] {
        const boardManager = getGameContext()?.boardManager ?? null;
        const results: OrderCheckResult[] = [];

        if (!boardManager) {
            console.error('[OrderManager] BoardManager not found');
            return results;
        }

        for (const order of this._currentOrders) {
            results.push(this.checkSingleOrder(order, boardManager));
        }

        return results;
    }

    /**
     * 完成指定订单
     * @param orderId 订单 ID
     * @returns 是否成功完成
     */
    public completeOrder(orderId: string): boolean {
        const order = this._currentOrders.find(o => o.id === orderId);
        if (!order) {
            console.error(`[OrderManager] order not found: ${orderId}`);
            return false;
        }

        const boardManager = getGameContext()?.boardManager ?? null;
        if (!boardManager) {
            console.error('[OrderManager] BoardManager not found');
            return false;
        }

        const statusResult = this.checkSingleOrder(order, boardManager);
        if (statusResult.status !== OrderStatus.COMPLETE) {
            console.log(`[Order] Cannot complete ${orderId}: ${statusResult.status}`);
            return false;
        }

        console.log(`[Order] Complete start: ${order.id}`);

        const itemsToRemove: { itemData: ItemData; node: Node }[] = [];
        for (const req of order.items) {
            let remaining = req.count;
            for (let col = 0; col < BoardManager.COLS && remaining > 0; col++) {
                for (let row = 0; row < BoardManager.ROWS && remaining > 0; row++) {
                    const itemData = boardManager.getItem(col, row);
                    if (itemData && itemData.itemId === req.itemId) {
                        const node = this.findItemNode(itemData);
                        if (node) {
                            itemsToRemove.push({ itemData, node });
                            remaining--;
                        }
                    }
                }
            }
        }

        this.animateItemsToOrder(itemsToRemove, () => {
            for (const { node } of itemsToRemove) {
                if (node.isValid) {
                    ItemManager.instance.destroyItem(node);
                }
            }

            ResourceManager.instance.addGold(order.reward);
            this.refreshOrder(order);
            EventManager.instance.emit(EventManager.ORDER_CHANGED);

            console.log(`[Order] Complete: ${order.id}, reward +${order.reward} gold`);
        });

        return true;
    }

    /**
     * 加载订单配置
     */
    private loadOrders(): void {
        const config = (ordersConfig as any).default ?? ordersConfig;
        const list = Array.isArray(config) ? config : [];
        this._allOrders = list.map((o: any) => new OrderData(o));
        console.log(`[OrderManager] loaded ${this._allOrders.length} orders`);
        // 初始订单加载完成后派发事件
        EventManager.instance.emit(EventManager.ORDER_CHANGED);
    }

    /**
     * 随机生成不重复的当前订单
     * @param count 订单数量
     */
    private generateCurrentOrders(count: number): void {
        this._currentOrders = [];
        const pool = [...this._allOrders];

        while (this._currentOrders.length < count && pool.length > 0) {
            const index = Math.floor(Math.random() * pool.length);
            this._currentOrders.push(pool[index]);
            pool.splice(index, 1);
        }
    }

    /**
     * 检测单个订单的状态
     */
    private checkSingleOrder(order: OrderData, boardManager: BoardManager): OrderCheckResult {
        let hasAny = false;
        let isComplete = true;
        const progressParts: string[] = [];

        for (const req of order.items) {
            const count = this.countItemOnBoard(req.itemId, boardManager);
            if (count > 0) {
                hasAny = true;
            }
            if (count < req.count) {
                isComplete = false;
            }
            progressParts.push(`${req.itemId}: ${count}/${req.count}`);
        }

        let status = OrderStatus.UNFINISHED;
        if (isComplete) {
            status = OrderStatus.COMPLETE;
        } else if (hasAny) {
            status = OrderStatus.PARTIAL;
        }

        return { order, status, progress: progressParts.join(', ') };
    }

    /**
     * 统计棋盘上指定 itemId 的数量
     */
    private countItemOnBoard(itemId: string, boardManager: BoardManager): number {
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
     * 在棋盘父节点下查找与 ItemData 绑定的节点
     */
    private findItemNode(itemData: ItemData): Node | null {
        const boardRoot = getGameContext()?.boardPanel ?? null;
        if (!boardRoot) {
            return null;
        }

        for (const child of boardRoot.children) {
            const comp = child.getComponent('Item') as unknown as { data: ItemData | null } | null;
            if (comp && comp.data === itemData) {
                return child;
            }
        }
        return null;
    }

    /**
     * 将物品动画移动到目标位置，完成后回调
     */
    private animateItemsToOrder(items: { itemData: ItemData; node: Node }[], callback: () => void): void {
        const boardRoot = getGameContext()?.boardPanel ?? null;
        if (!boardRoot) {
            callback();
            return;
        }

        const targetWorldPos = this.getOrderTargetWorldPos();
        const promises: Promise<void>[] = [];

        for (const { node } of items) {
            const targetLocalPos = this.worldToLocal(targetWorldPos, boardRoot);
            promises.push(new Promise(resolve => {
                tween(node)
                    .to(0.3, { position: targetLocalPos })
                    .call(() => resolve())
                    .start();
            }));
        }

        Promise.all(promises).then(() => callback());
    }

    /**
     * 获取订单目标位置（世界坐标）
     * 优先使用 orderPanel 的位置，否则使用固定默认值
     */
    private getOrderTargetWorldPos(): Vec3 {
        const orderPanel = getGameContext()?.orderPanel ?? null;
        if (orderPanel) {
            return orderPanel.worldPosition;
        }
        return new Vec3(0, 500, 0);
    }

    /**
     * 将世界坐标转换为棋盘父节点本地坐标
     */
    private worldToLocal(worldPos: Vec3, boardRoot: Node): Vec3 {
        const rootWorldPos = boardRoot.getWorldPosition();
        return new Vec3(
            worldPos.x - rootWorldPos.x,
            worldPos.y - rootWorldPos.y,
            worldPos.z - rootWorldPos.z
        );
    }

    /**
     * 完成订单后刷新：移除已完成订单，随机补一个新订单
     */
    private refreshOrder(completedOrder: OrderData): void {
        this._currentOrders = this._currentOrders.filter(o => o.id !== completedOrder.id);

        const usedIds = new Set(this._currentOrders.map(o => o.id));
        const candidates = this._allOrders.filter(o => !usedIds.has(o.id));

        if (candidates.length > 0) {
            const next = candidates[Math.floor(Math.random() * candidates.length)];
            this._currentOrders.push(next);
            console.log(`[OrderManager] new order added: ${next.id}`);
        }
    }
}
