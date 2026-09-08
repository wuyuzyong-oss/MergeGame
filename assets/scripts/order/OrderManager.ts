import { Vec3, Node, tween, UITransform } from 'cc';
import * as orderPoolConfig from '../../configs/order_pool.json';
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
 * 单个需求物品的就绪状态
 */
export interface OrderItemReady {
    itemId: string;
    count: number;
    ready: boolean;       // 棋盘上是否存在足够数量
    currentCount: number; // 棋盘上当前数量
}

/**
 * 单个订单的检测结果
 */
export interface OrderCheckResult {
    order: OrderData;
    status: OrderStatus;
    itemStatus: OrderItemReady[]; // 每个物品的就绪状态
}

/**
 * 订单管理器
 * 负责订单池加载、随机抽取、就绪检查、完成扣除、自动补充、命中排序
 */
export class OrderManager {
    private static _instance: OrderManager = new OrderManager();
    public static get instance(): OrderManager {
        return OrderManager._instance;
    }

    private _orderPool: OrderData[] = [];
    private _currentOrders: OrderData[] = [];

    /** 可用的NPC列表（7个，对应 textures/npc/ 下的7个文件夹） */
    private static readonly NPC_IDS: string[] = ['npc_01', 'npc_02', 'npc_03', 'npc_04', 'npc_05', 'npc_06', 'npc_07'];

    /**
     * 初始化订单系统
     */
    public init(): void {
        this.loadOrderPool();
        this.generateCurrentOrders(5);
        this.bindEvents();
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

        // 收集需要移除的物品节点
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

        // 获取对应订单卡片的世界坐标（物品飞向这个订单托盘，而不是整个面板）
        // 注意：getGameContext().orderPanel 存的是 Node，需要 getComponent 获取 OrderPanel 组件
        const orderPanelNode = getGameContext()?.orderPanel ?? null;
        const orderPanel = orderPanelNode ? orderPanelNode.getComponent('OrderPanel' as any) : null;
        const targetWorldPos = orderPanel?.getCardWorldPosition(order.id) ?? this.getOrderTargetWorldPos();

        // 物品飞向对应订单托盘
        this.animateItemsToOrder(itemsToRemove, targetWorldPos, () => {
            // 飞行完成后，物品先快速消失（0.1秒缩放），然后订单再消失
            this.animateItemsDisappear(itemsToRemove, () => {
                // 物品消失后，同时播放订单卡片缩放消失动画和金币飞行动画
                if (orderPanel) {
                    // 先获取订单卡片的世界坐标（在订单消失前，否则卡片移除后找不到）
                    const cardWorldPos = orderPanel.getCardWorldPosition(order.id);
                    if (cardWorldPos) {
                        // 同时开始：订单消失动画 + 金币飞行动画
                        orderPanel.playCardDisappear(order.id, () => {
                            // 订单消失完成（卡片已从数组移除），不需要额外处理
                        });
                        // 金币散落完成后，延迟一会儿再补充订单，避免补充太快
                        orderPanel.playCoinFlyAnimation(cardWorldPos, order.reward, () => {
                            setTimeout(() => {
                                this.finalizeCompleteOrder(order, itemsToRemove);
                            }, OrderManager.ORDER_REFILL_DELAY * 1000);
                        });
                    } else {
                        // 找不到订单位置，直接 finalize
                        orderPanel.playCardDisappear(order.id, () => {
                            this.finalizeCompleteOrder(order, itemsToRemove);
                        });
                    }
                } else {
                    this.finalizeCompleteOrder(order, itemsToRemove);
                }
            });
        });

        return true;
    }

    /**
     * 完成订单的最终处理（物品销毁、补充订单、发事件）
     * 注意：金币已在金币飞行动画中逐步增加，这里不再加金币
     * 在物品飞行、订单消失和金币飞行动画完成后调用
     */
    private finalizeCompleteOrder(order: OrderData, itemsToRemove: { itemData: ItemData; node: Node }[]): void {
        for (const { node } of itemsToRemove) {
            if (node.isValid) {
                ItemManager.instance.destroyItem(node);
            }
        }

        this.refreshOrder(order);
        EventManager.instance.emit(EventManager.ORDER_CHANGED);

        console.log(`[Order] Complete: ${order.id}, reward +${order.reward} gold (via coin fly animation)`);
    }
    /**
     * 将命中的订单移到最前面
     * @param orderId 订单ID
     * @returns 是否移动成功
     */
    public moveOrderToFront(orderId: string): boolean {
        const index = this._currentOrders.findIndex(o => o.id === orderId);
        if (index <= 0) {
            return false; // 已经在最前或不存在
        }
        const [order] = this._currentOrders.splice(index, 1);
        this._currentOrders.unshift(order);
        console.log(`[OrderManager] order ${orderId} moved to front`);
        return true;
    }

    /**
     * 检查某个物品是否命中当前某个订单
     * 如果命中，将该订单移到最前
     * @param itemId 物品ID
     * @returns 命中的订单ID，未命中返回null
     */
    public checkItemHitAndMove(itemId: string): string | null {
        for (const order of this._currentOrders) {
            for (const req of order.items) {
                if (req.itemId === itemId) {
                    this.moveOrderToFront(order.id);
                    return order.id;
                }
            }
        }
        return null;
    }

    // ==================== 内部方法 ====================

    /**
     * 加载订单池配置
     */
    private loadOrderPool(): void {
        const config = (orderPoolConfig as any).default ?? orderPoolConfig;
        const list = config?.orders as any[];
        if (!Array.isArray(list)) {
            console.error('[OrderManager] order_pool.json format error');
            return;
        }
        this._orderPool = list.map((o: any) => new OrderData(o));
        console.log(`[OrderManager] loaded ${this._orderPool.length} orders from pool`);
    }

    /**
     * 随机生成不重复的当前订单
     * @param count 订单数量
     */
    private generateCurrentOrders(count: number): void {
        this._currentOrders = [];
        const pool = [...this._orderPool];

        while (this._currentOrders.length < count && pool.length > 0) {
            const index = Math.floor(Math.random() * pool.length);
            this._currentOrders.push(pool[index]);
            pool.splice(index, 1);
        }

        // 随机分配不重复的NPC（从7个NPC里选count个不重复的）
        this.assignUniqueNPCs(this._currentOrders);
    }

    /**
     * 给订单列表分配不重复的NPC
     */
    private assignUniqueNPCs(orders: OrderData[]): void {
        const npcPool = [...OrderManager.NPC_IDS];
        for (const order of orders) {
            if (npcPool.length > 0) {
                const npcIndex = Math.floor(Math.random() * npcPool.length);
                order.npcId = npcPool[npcIndex];
                npcPool.splice(npcIndex, 1);
            }
        }
    }

    /**
     * 检测单个订单的状态
     */
    private checkSingleOrder(order: OrderData, boardManager: BoardManager): OrderCheckResult {
        let hasAny = false;
        let isComplete = true;
        const itemStatus: OrderItemReady[] = [];

        for (const req of order.items) {
            const count = this.countItemOnBoard(req.itemId, boardManager);
            const ready = count >= req.count;
            if (count > 0) {
                hasAny = true;
            }
            if (!ready) {
                isComplete = false;
            }
            itemStatus.push({
                itemId: req.itemId,
                count: req.count,
                ready,
                currentCount: count,
            });
        }

        let status = OrderStatus.UNFINISHED;
        if (isComplete) {
            status = OrderStatus.COMPLETE;
        } else if (hasAny) {
            status = OrderStatus.PARTIAL;
        }

        return { order, status, itemStatus };
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
     * 在棋盘根节点下查找与 ItemData 绑定的节点
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
    private animateItemsToOrder(items: { itemData: ItemData; node: Node }[], targetWorldPos: Vec3, callback: () => void): void {
        const orderPanelNode = getGameContext()?.orderPanel ?? null;
        if (!orderPanelNode) {
            callback();
            return;
        }

        const orderTransform = orderPanelNode.getComponent(UITransform);
        if (!orderTransform) {
            callback();
            return;
        }

        // 目标位置转换成相对于 orderPanelNode 的坐标
        const targetLocalPos = orderTransform.convertToNodeSpaceAR(targetWorldPos);

        const promises: Promise<void>[] = [];

        for (const { node } of items) {
            // 保存物品当前世界坐标
            const itemWorldPos = node.getWorldPosition();
            // 把物品节点移到 orderPanelNode 下（物品在订单面板层级，不会被棋盘或订单卡片盖住）
            node.setParent(orderPanelNode);
            // 设置物品节点的位置为相对于 orderPanelNode 的坐标
            const itemLocalPos = orderTransform.convertToNodeSpaceAR(itemWorldPos);
            node.setPosition(itemLocalPos);
            // 移到最上层，不被订单卡片（托盘/对勾/完成按钮）盖住
            node.setSiblingIndex(orderPanelNode.children.length - 1);

            promises.push(new Promise(resolve => {
                tween(node)
                    .to(0.3, { position: targetLocalPos.clone() })
                    .call(() => resolve())
                    .start();
            }));
        }

        Promise.all(promises).then(() => callback());
    }

    /**
     * 物品快速缩放消失动画（0.1秒），完成后销毁物品
     * 在物品飞到订单后、订单消失前调用，保证物品先于订单消失
     */
    private animateItemsDisappear(items: { itemData: ItemData; node: Node }[], callback: () => void): void {
        const promises: Promise<void>[] = [];

        for (const { node } of items) {
            if (!node.isValid) continue;
            promises.push(new Promise(resolve => {
                const scaleObj = { s: 1 };
                tween(scaleObj)
                    .to(0.1, { s: 0 }, {
                        onUpdate: (target: any, ratio: number) => {
                            if (node.isValid) {
                                node.setScale(target.s, target.s, 1);
                            }
                        }
                    })
                    .call(() => {
                        if (node.isValid) {
                            ItemManager.instance.destroyItem(node);
                        }
                        resolve();
                    })
                    .start();
            }));
        }

        Promise.all(promises).then(() => callback());
    }

    /**
     * 获取订单目标位置（世界坐标）
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
        const candidates = this._orderPool.filter(o => !usedIds.has(o.id));

        if (candidates.length > 0) {
            const next = candidates[Math.floor(Math.random() * candidates.length)];
            // 分配一个与当前4个订单不重复的NPC
            const usedNPCs = new Set(this._currentOrders.map(o => o.npcId));
            const availableNPCs = OrderManager.NPC_IDS.filter(n => !usedNPCs.has(n));
            if (availableNPCs.length > 0) {
                next.npcId = availableNPCs[Math.floor(Math.random() * availableNPCs.length)];
            }
            this._currentOrders.push(next);
            console.log(`[OrderManager] new order added: ${next.id}`);

            // 如果新订单所有物品都已就绪，自动移到最前面
            const boardManager = getGameContext()?.boardManager ?? null;
            if (boardManager) {
                const result = this.checkSingleOrder(next, boardManager);
                if (result.status === OrderStatus.COMPLETE) {
                    this.moveOrderToFront(next.id);
                    console.log(`[OrderManager] new order ${next.id} is complete, moved to front`);
                }
            }
        }
    }

    /**
     * 绑定事件：监听新物品生成，命中订单则移到最前
     */
    private bindEvents(): void {
        EventManager.instance.on(EventManager.ITEM_SPAWNED, (itemData: any) => {
            const itemId = itemData?.itemId;
            if (itemId) {
                const hitOrderId = this.checkItemHitAndMove(itemId);
                if (hitOrderId) {
                    console.log(`[OrderManager] item ${itemId} hit order ${hitOrderId}, moved to front`);
                    EventManager.instance.emit(EventManager.ORDER_CHANGED);
                }
            }
        });
    }
}
