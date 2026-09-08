import { _decorator, Component, Node, Vec3, UITransform, ScrollView, Mask, Layout } from 'cc';
import { OrderManager, OrderCheckResult } from '../order/OrderManager';
import { OrderCard } from '../order/OrderCard';
import { EventManager } from '../core/EventManager';

const { ccclass, property } = _decorator;

/**
 * 订单面板
 * 横向滚动容器，显示5个订单卡片，一屏约2个
 *
 * 结构：
 * OrderPanel
 * └── ScrollView（Mask + ScrollView，可视区域裁剪）
 *     └── Content（Layout 水平排列，包含5个 OrderCard）
 *         ├── OrderCard[0]
 *         ├── OrderCard[1]
 *         ├── ...
 *         └── OrderCard[4]
 */
@ccclass('OrderPanel')
export class OrderPanel extends Component {
    // ==================== 订单区域配置（修改这里即可调整订单区域的位置和大小） ====================

    /** 订单面板在屏幕上的位置X（相对于Canvas中心） */
    public static readonly POSITION_X = 0;
    /** 订单面板底部在屏幕上的位置Y（相对于Canvas中心，正值=向上，面板从这里向上延伸） */
    public static readonly POSITION_Y = 500;

    /** 面板总宽度（一般等于屏幕宽度1080，不影响可视区域） */
    private static readonly PANEL_WIDTH = 1080;
    /** 面板总高度（等于可视区域高度，底部对齐后不需要额外空间） */
    private static readonly PANEL_HEIGHT = 400;

    /** 可视区域宽度（一屏显示几个卡片由这个决定，卡片宽300+间距40，760约2个半） */
    private static readonly VIEW_WIDTH = 1080;
    /** 可视区域高度（卡片高133+NPC超出部分，约170） */
    private static readonly VIEW_HEIGHT = 400;

    /** 卡片之间的间距 */
    private static readonly CARD_SPACING = 30;
    /** 底部边距（卡片离面板底部的距离，对勾超出卡片底部时调大这个值，当前对勾超出约34px，设40刚好） */
    private static readonly BOTTOM_PADDING = 20;

    private _scrollView: ScrollView | null = null;
    private _contentNode: Node | null = null;
    private _cards: OrderCard[] = [];

    onLoad() {
        this.node.setPosition(OrderPanel.POSITION_X, OrderPanel.POSITION_Y, 0);
        this.buildUI();
        this.bindEvents();
        this.refreshAll();
    }

    onDestroy(): void {
        EventManager.instance.offAll(this.onOrdersChanged);
        EventManager.instance.offAll(this.onItemsChanged);
        this.clearCards();
    }

    // ==================== UI 构建 ====================

    private buildUI(): void {
        // 面板容器
        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(OrderPanel.PANEL_WIDTH, OrderPanel.PANEL_HEIGHT);
        transform.setAnchorPoint(0.5, 0);

        // ScrollView 节点（带 Mask 裁剪）
        const scrollNode = new Node('ScrollView');
        const scrollTransform = scrollNode.addComponent(UITransform);
        scrollTransform.setContentSize(OrderPanel.VIEW_WIDTH, OrderPanel.VIEW_HEIGHT);
        scrollTransform.setAnchorPoint(0.5, 0);
        scrollNode.setPosition(0, 0, 0);

        // Mask 组件（裁剪超出可视区域的内容）
        scrollNode.addComponent(Mask);

        // ScrollView 组件
        this._scrollView = scrollNode.addComponent(ScrollView);
        this._scrollView.horizontal = true;
        this._scrollView.vertical = false;
        this._scrollView.inertia = true;
        this._scrollView.brake = 0.5;

        // Content 节点（所有卡片的父节点，Layout 水平排列）
        this._contentNode = new Node('Content');
        const contentTransform = this._contentNode.addComponent(UITransform);
        contentTransform.setAnchorPoint(0, 0);
        contentTransform.setContentSize(0, OrderCard.CARD_HEIGHT + OrderPanel.BOTTOM_PADDING);

        // Layout 组件：水平排列，自动适应内容宽度
        const layout = this._contentNode.addComponent(Layout);
        layout.type = Layout.Type.HORIZONTAL;
        layout.spacingX = OrderPanel.CARD_SPACING;
        layout.paddingLeft = 20;
        layout.paddingRight = 20;
        layout.resizeMode = Layout.ResizeMode.CONTAINER;
        layout.verticalDirection = Layout.VerticalDirection.TOP_TO_BOTTOM;

        this._contentNode.setParent(scrollNode);

        // 设置 ScrollView 的 content
        this._scrollView.content = this._contentNode;

        scrollNode.setParent(this.node);
    }

    // ==================== 卡片管理 ====================

    /**
     * 完全重建所有卡片
     */
    private rebuildCards(): void {
        this.clearCards();

        const checkResults = OrderManager.instance.checkOrders();
        if (checkResults.length === 0) {
            return;
        }

        for (let i = 0; i < checkResults.length; i++) {
            const result = checkResults[i];
            const card = new OrderCard();
            card.node.setParent(this._contentNode);
            card.node.setPosition(card.node.position.x, OrderCard.CARD_HEIGHT / 2 + OrderPanel.BOTTOM_PADDING, 0);
            card.setup(result.order, result.itemStatus, result.status, () => {
                this.handleCompleteOrder(result.order.id);
            });
            this._cards.push(card);
        }

        // 强制 Layout 立即更新
        this.scheduleOnce(() => {
            if (this._contentNode) {
                const layout = this._contentNode.getComponent(Layout);
                if (layout) {
                    layout.updateLayout();
                }
            }
        }, 0.05);
    }

    /**
     * 刷新现有卡片的数据（不重建节点）
     */
    private refreshCards(): void {
        const checkResults = OrderManager.instance.checkOrders();

        // 订单数量变化 → 完全重建
        if (checkResults.length !== this._cards.length) {
            this.rebuildCards();
            return;
        }

        // 逐卡片刷新
        for (let i = 0; i < checkResults.length; i++) {
            const result = checkResults[i];
            this._cards[i].setup(result.order, result.itemStatus, result.status, () => {
                this.handleCompleteOrder(result.order.id);
            });
        }
    }

    /**
     * 清理所有卡片
     */
    private clearCards(): void {
        for (const card of this._cards) {
            card.dispose();
        }
        this._cards = [];
    }

    /**
     * 完整刷新（重建卡片 + 滚动到最前）
     */
    private refreshAll(): void {
        this.rebuildCards();
        // 滚动到最左边（第一个订单）
        this.scheduleOnce(() => {
            if (this._scrollView) {
                this._scrollView.scrollToLeft(0.1);
            }
        }, 0.1);
    }

    /**
     * 获取指定订单卡片的世界坐标（用于物品飞行目标位置）
     */
    public getCardWorldPosition(orderId: string): Vec3 | null {
        const card = this._cards.find(c => c.getOrderId() === orderId);
        return card ? card.getWorldPosition() : null;
    }

    /**
     * 播放指定订单卡片的缩放消失动画
     */
    public playCardDisappear(orderId: string, callback: () => void): void {
        const card = this._cards.find(c => c.getOrderId() === orderId);
        if (card) {
            card.playDisappearAnimation(() => {
                // 动画完成后立即从 _cards 数组移除，避免期间 refreshCards 访问已销毁节点
                this._cards = this._cards.filter(c => c !== card);
                callback();
            });
        } else {
            callback();
        }
    }
    // ==================== 订单操作 ====================

    private handleCompleteOrder(orderId: string): void {
        const success = OrderManager.instance.completeOrder(orderId);
        if (success) {
            console.log(`[OrderPanel] complete order: ${orderId}`);
            // 刷新由 OrderManager 的 ORDER_CHANGED 事件触发，不需要手动延迟刷新
            // （手动刷新会在缩放动画完成前重建卡片，导致"重新放大"闪烁）
        }
    }

    // ==================== 事件绑定 ====================

    private bindEvents(): void {
        EventManager.instance.on(EventManager.ORDER_CHANGED, this.onOrdersChanged);
        EventManager.instance.on(EventManager.ITEM_SPAWNED, this.onItemsChanged);
        EventManager.instance.on(EventManager.ITEM_MERGED, this.onItemsChanged);
    }

    private onOrdersChanged = (): void => {
        this.scheduleOnce(() => {
            this.refreshAll();
        }, 0.1);
    };

    private onItemsChanged = (): void => {
        this.scheduleOnce(() => {
            this.refreshCards();
        }, 0.1);
    };
}
