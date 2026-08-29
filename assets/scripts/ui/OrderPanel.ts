import { _decorator, Component, Node, UITransform, Graphics, Color, Label } from 'cc';
import { OrderManager, OrderCheckResult, OrderStatus } from '../order/OrderManager';
import { OrderItemView } from '../order/OrderItemView';
import { EventManager } from '../core/EventManager';

const { ccclass, property } = _decorator;

/**
 * 订单面板
 * 显示当前 5 个订单，自动检测订单状态并刷新
 *
 * 数据流：
 * OrderManager.getCurrentOrders() → OrderItemView 显示
 * OrderManager.checkOrders()     → 按钮可见性
 * 点击完成 → OrderManager.completeOrder() → UI 自动刷新
 */
@ccclass('OrderPanel')
export class OrderPanel extends Component {
    private _itemViews: OrderItemView[] = [];
    private _lastSignature: string = '';

    /** 面板宽度 */
    private static readonly PANEL_WIDTH = 1080;
    /** 面板高度 */
    private static readonly PANEL_HEIGHT = 500;
    /** 单个订单间距 */
    private static readonly ITEM_SPACING = 90;

    onLoad() {
        this.buildUI();
        this.bindEvents();
    }

    onDestroy(): void {
        // 一次性清理所有事件监听
        EventManager.instance.offAll(this.onOrdersChanged);
        EventManager.instance.offAll(this.onGoldChanged);
    }

    // ==================== UI 构建 ====================

    private buildUI(): void {
        // 面板容器
        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(OrderPanel.PANEL_WIDTH, OrderPanel.PANEL_HEIGHT);
        transform.setAnchorPoint(0.5, 0.5);

        // 半透明背景
        const bg = this.node.addComponent(Graphics);
        bg.fillColor = new Color(15, 15, 25, 160);
        bg.roundRect(-540, -250, 1080, 500, 12);
        bg.fill();

        // 标题
        const titleNode = new Node('Title');
        const titleTransform = titleNode.addComponent(UITransform);
        titleTransform.setContentSize(200, 40);
        titleTransform.setAnchorPoint(0.5, 0.5);
        titleNode.setPosition(0, 220, 0);

        const titleLabel = titleNode.addComponent(Label);
        titleLabel.string = '📋 订单';
        titleLabel.fontSize = 28;
        titleLabel.lineHeight = 30;
        titleLabel.color = new Color(255, 255, 255, 255);
        titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
        titleNode.setParent(this.node);

        // 首次构建订单视图
        this.rebuildViews();
    }

    // ==================== 订单视图管理 ====================

    /**
     * 完全重建订单视图列表
     */
    private rebuildViews(): void {
        // 清理旧视图
        this.clearViews();

        const checkResults = OrderManager.instance.checkOrders();
        if (checkResults.length === 0) {
            return;
        }

        // 垂直居中起始 Y（标题下方）
        const startY = 170;

        for (let i = 0; i < checkResults.length; i++) {
            const result = checkResults[i];
            const view = new OrderItemView();
            view.node.setParent(this.node);
            view.node.setPosition(0, startY - i * OrderPanel.ITEM_SPACING, 0);
            view.setup(result.order, result.status, () => {
                this.handleCompleteOrder(result.order.id);
            });
            this._itemViews.push(view);
        }
    }

    /**
     * 刷新现有视图（不重建节点）
     */
    private refreshViews(): void {
        const checkResults = OrderManager.instance.checkOrders();

        // 订单数量变化 → 完全重建
        if (checkResults.length !== this._itemViews.length) {
            this.rebuildViews();
            return;
        }

        // 逐项刷新
        for (let i = 0; i < checkResults.length; i++) {
            const result = checkResults[i];
            this._itemViews[i].setup(result.order, result.status, () => {
                this.handleCompleteOrder(result.order.id);
            });
        }
    }

    /**
     * 清理所有订单视图
     */
    private clearViews(): void {
        for (const view of this._itemViews) {
            view.dispose();
        }
        this._itemViews = [];
    }

    // ==================== 订单操作 ====================

    private handleCompleteOrder(orderId: string): void {
        const success = OrderManager.instance.completeOrder(orderId);
        if (success) {
            console.log(`[OrderPanel] complete order: ${orderId}`);
            // 延迟刷新，等待 OrderManager 动画和刷新完成
            this.scheduleOnce(() => {
                this.rebuildViews();
                this._lastSignature = this.getOrderSignature();
            }, 0.5);
        }
    }

    // ==================== 辅助方法 ====================

    /**
     * 获取当前订单列表签名，用于检测变化
     */
    private getOrderSignature(): string {
        const orders = OrderManager.instance.getCurrentOrders();
        return orders.map(o => o.id).join(',');
    }

    /** 订单/物品变化时的统一刷新回调 */
    private onOrdersChanged = (): void => {
        this.scheduleOnce(() => {
            this.rebuildViews();
            this._lastSignature = this.getOrderSignature();
        }, 0.1);
    };

    /** 金币变化时可能意味着订单完成 */
    private onGoldChanged = (): void => {
        this.scheduleOnce(() => {
            this.rebuildViews();
            this._lastSignature = this.getOrderSignature();
        }, 0.6);
    };

    /**
     * 绑定事件：监听订单变化、物品生成/合成、金币变化
     */
    private bindEvents(): void {
        EventManager.instance.on(EventManager.ORDER_CHANGED, this.onOrdersChanged);
        EventManager.instance.on(EventManager.ITEM_SPAWNED, this.onOrdersChanged);
        EventManager.instance.on(EventManager.ITEM_MERGED, this.onOrdersChanged);
        EventManager.instance.on(EventManager.GOLD_CHANGED, this.onGoldChanged);
    }
}
