import { _decorator, Component, Node, Vec3, UITransform, ScrollView, Mask, Layout, Sprite, SpriteFrame, Texture2D, resources, tween } from 'cc';
import { OrderManager, OrderCheckResult } from '../order/OrderManager';
import { OrderCard } from '../order/OrderCard';
import { EventManager } from '../core/EventManager';
import { ResourceManager } from '../resource/ResourceManager';
import { getGameContext } from '../core/GameContext';
import { AudioManager } from '../AudioManager';

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
    public static readonly POSITION_Y = 400;

    /** 面板总宽度（一般等于屏幕宽度1080，不影响可视区域） */
    private static readonly PANEL_WIDTH = 1080;
    /** 面板总高度（等于可视区域高度，底部对齐后不需要额外空间） */
    private static readonly PANEL_HEIGHT = 430;

    /** 可视区域宽度（一屏显示几个卡片由这个决定，卡片宽300+间距40，760约2个半） */
    private static readonly VIEW_WIDTH = 1080;
    /** 可视区域高度（卡片高133+NPC超出部分，约170） */
    private static readonly VIEW_HEIGHT = 350;

    /** 卡片之间的间距 */
    private static readonly CARD_SPACING = 30;
    /** 底部边距（卡片离面板底部的距离，对勾超出卡片底部时调大这个值，当前对勾超出约34px，设40刚好） */
    private static readonly BOTTOM_PADDING = 20;

    // ==================== 金币飞行动画配置 ====================
    /** 金币数量 */
    private static readonly COIN_COUNT = 10;
    /** 金币尺寸 */
    private static readonly COIN_SIZE = 60;
    /** 金币散落范围X（相对于订单位置） */
    private static readonly COIN_SCATTER_X = 80;
    /** 金币散落范围Y（向下，相对于订单位置） */
    private static readonly COIN_SCATTER_Y = 60;
    /** 每个金币出现的间隔（从少到多） */
    private static readonly COIN_SPAWN_INTERVAL = 0.07;
    /** 金币出现动画时长（从小到大缩放） */
    private static readonly COIN_SPAWN_DURATION = 0.2;
    /** 金币飞向终点的时长 */
    private static readonly COIN_FLY_DURATION = 0.5;
    /** 金币icon图片路径 */
    private static readonly COIN_ICON_PATH = 'textures/ui/coin_icon';

    private _scrollView: ScrollView | null = null;
    private _contentNode: Node | null = null;
    private _cards: OrderCard[] = [];

    /** 金币icon缓存（静态，所有实例共享） */
    private static _coinSpriteFrame: SpriteFrame | null = null;

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

    // ==================== 金币飞行动画 ====================

    /**
     * 加载金币icon（静态缓存 + 子路径/主路径双重容错）
     */
    private loadCoinIcon(callback: (sf: SpriteFrame | null) => void): void {
        if (OrderPanel._coinSpriteFrame) {
            callback(OrderPanel._coinSpriteFrame);
            return;
        }
        const tryLoad = (path: string, onFail: () => void) => {
            resources.load(path, Texture2D, (err, texture) => {
                if (err || !texture) { onFail(); return; }
                const sf = new SpriteFrame();
                sf.texture = texture;
                OrderPanel._coinSpriteFrame = sf;
                callback(sf);
            });
        };
        tryLoad(OrderPanel.COIN_ICON_PATH, () => {
            tryLoad(`${OrderPanel.COIN_ICON_PATH}/texture`, () => {
                console.warn(`[OrderPanel] 金币icon加载失败: ${OrderPanel.COIN_ICON_PATH}`);
                callback(null);
            });
        });
    }

    /**
     * 播放金币飞行动画
     * 订单消失的同时，从订单位置散落10个金币，按顺序飞向账号区域金币位置
     * 每个金币到达后消失，同时金币数字涨 reward/10
     * @param startPos 起点世界坐标（订单卡片位置，需在订单消失前获取）
     * @param reward 订单奖励金币总数
     * @param callback 所有金币散落完成后的回调（立即补充订单）
     */
    public playCoinFlyAnimation(startPos: Vec3, reward: number, callback: () => void): void {
        // 1. 起点（直接使用传入的订单卡片世界坐标，避免订单消失后找不到）
        const startWorldPos = startPos;

        // 2. 获取终点（账号区域金币世界坐标）
        const accountPanelNode = getGameContext()?.accountPanel ?? null;
        const accountPanel = accountPanelNode ? accountPanelNode.getComponent('AccountPanel' as any) : null;
        const endWorldPos = accountPanel?.getGoldWorldPosition();
        if (!endWorldPos) {
            ResourceManager.instance.addGold(reward);
            callback();
            return;
        }

        // 3. 转换成 OrderPanel 本地坐标（金币挂在 OrderPanel 节点下，不被 ScrollView Mask 裁剪）
        const uiTransform = this.node.getComponent(UITransform);
        const startLocalPos = uiTransform ? uiTransform.convertToNodeSpaceAR(startWorldPos) : startWorldPos.clone();
        const endLocalPos = uiTransform ? uiTransform.convertToNodeSpaceAR(endWorldPos) : endWorldPos.clone();

        // 4. 加载金币icon后创建10个金币
        this.loadCoinIcon((coinSF) => {
            const coinCount = OrderPanel.COIN_COUNT;
            const goldPerCoin = Math.floor(reward / coinCount);  // 每个金币的整数部分
            const lastCoinGold = reward - goldPerCoin * (coinCount - 1);  // 最后一个金币加剩余的，保证总数是整数
            let spawnedCount = 0;  // 散落完成的金币数
            let callbackFired = false;
            let arrivedCount = 0;  // 到达终点的金币数（用于触发第一个金币到达时的爆发特效）

            for (let i = 0; i < coinCount; i++) {
                const coinNode = new Node('FlyCoin');
                const transform = coinNode.addComponent(UITransform);
                const sprite = coinNode.addComponent(Sprite);
                // 关键：先设置 sizeMode=CUSTOM，再设置 spriteFrame，否则设置图片时会自动把 contentSize 改成图片原始尺寸
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                if (coinSF) { sprite.spriteFrame = coinSF; }
                // 设置图片后再确认一次 contentSize，防止被覆盖
                transform.setContentSize(OrderPanel.COIN_SIZE, OrderPanel.COIN_SIZE);
                coinNode.setParent(this.node);
                coinNode.setPosition(startLocalPos);
                coinNode.setScale(0, 0, 0);

                // 散落位置：订单下方随机偏移
                const scatterX = startLocalPos.x + (Math.random() - 0.5) * OrderPanel.COIN_SCATTER_X;
                const scatterY = startLocalPos.y - OrderPanel.COIN_SCATTER_Y * (0.5 + Math.random() * 0.5);
                const scatterPos = new Vec3(scatterX, scatterY, 0);

                // 动画：延迟出现（从少到多）→ 从小到大缩放+散落 → 全部散落完成就补充订单 → 飞向终点 → 到达后消失+加金币
                tween(coinNode)
                    .delay(i * OrderPanel.COIN_SPAWN_INTERVAL)
                    .parallel(
                        tween().to(OrderPanel.COIN_SPAWN_DURATION, { scale: new Vec3(1, 1, 1) }),
                        tween().to(OrderPanel.COIN_SPAWN_DURATION, { position: scatterPos })
                    )
                    .call(() => {
                        // 这个金币散落完成了
                        spawnedCount++;
                        if (spawnedCount >= coinCount && !callbackFired) {
                            callbackFired = true;
                            // 所有金币散落完成，开始飞向终点，播放金币飞行音效
                            AudioManager.instance.playSFX(AudioManager.SFX_COIN_FLY);
                            callback();  // 所有金币都散落完成，立即补充订单
                        }
                    })
                    .to(OrderPanel.COIN_FLY_DURATION, { position: endLocalPos })
                    .call(() => {
                        // 到达终点后消失+加金币（不影响订单补充）
                        if (coinNode.isValid) { coinNode.destroy(); }
                        // 最后一个金币加剩余的，保证总数是整数且没有小数
                        const addAmount = (i === coinCount - 1) ? lastCoinGold : goldPerCoin;
                        ResourceManager.instance.addGold(addAmount);

                        // 第一个金币到达时，触发账号金币icon的爆发特效（光环+星星）
                        arrivedCount++;
                        if (arrivedCount === 1 && accountPanel && endWorldPos) {
                            accountPanel.playCoinBurstEffect(endWorldPos);
                        }
                    })
                    .start();
            }
        });
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
