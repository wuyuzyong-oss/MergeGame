import { Node, Label, UITransform, Graphics, Color, Sprite, SpriteFrame, Texture2D, resources, tween, Vec3 } from 'cc';
import { OrderData } from './OrderData';
import { OrderItemReady, OrderStatus } from './OrderManager';

/**
 * 单个订单卡片
 * 纯节点构建类（不继承 Component）
 *
 * 层次（从下到上）：
 * 1. 卡片背景（order_card_bg.png，黄色+白色托盘）
 * 2. NPC形象（PNG序列帧动画，从 textures/npc/npc_xx/ 加载）
 * 3. 订单物品（1-3个，并排居中）
 * 4. 就绪对勾（每个物品下方，绿色=已就绪）
 * 5. 金额区（左下角，金币+数字）
 * 6. 完成按钮（右下角，全部就绪时显示）
 *
 * 所有尺寸/位置集中在顶部常量，改卡片尺寸时同步调整这些常量即可。
 */
export class OrderCard {
    public node: Node;

    // ==================== 尺寸常量（改卡片尺寸时同步调整这里） ====================

    /** 卡片宽度 */
    private static readonly CARD_WIDTH = 300;
    /** 卡片高度 */
    public static readonly CARD_HEIGHT = 133;

    /** NPC大小（序列帧强制缩放到这个尺寸，不管原图分辨率） */
    private static readonly NPC_SIZE = 300;
    /** NPC中心X（相对于卡片中心，正值=向右，负值=向左） */
    private static readonly NPC_X = -60;
    /** NPC中心Y（相对于卡片中心，正值=向上，顶部会超出卡片） */
    private static readonly NPC_Y = 150;
    /** NPC动画帧间隔（毫秒），数值越小播放越快 */
    private static readonly NPC_FRAME_INTERVAL = 50;

    /** 物品容器中心Y */
    private static readonly ITEM_CONTAINER_Y = 0;
    /** 单个物品显示大小（不管原图分辨率，强制缩放到这个尺寸） */
    private static readonly ITEM_SIZE = 80;
    /** 物品之间的间距 */
    private static readonly ITEM_SPACING = 10;
    /** 物品在容器内的Y偏移 */
    private static readonly ITEM_INNER_Y = 2;

    /** 对勾大小 */
    private static readonly CHECK_SIZE = 80;
    /** 对勾在容器内的Y偏移（物品下方，负值=向下） */
    private static readonly CHECK_OFFSET_Y = -40;
    /** 对勾icon图片路径（放在 assets/resources/textures/ui/check_icon.png，导入类型选texture） */
    private static readonly CHECK_ICON_PATH = 'textures/ui/check_icon';

    /** 金币区域中心X（相对于卡片中心，正值=向右，负值=向左） */
    private static readonly REWARD_X = 70;
    /** 金币区域中心Y（相对于卡片中心，正值=向上，负值=向下） */
    private static readonly REWARD_Y = 90;
    /** 半透明矩形底色宽度 */
    private static readonly REWARD_WIDTH = 140;
    /** 半透明矩形底色高度 */
    private static readonly REWARD_HEIGHT = 45;
    /** 底色透明度（0=完全透明，255=完全不透明） */
    private static readonly REWARD_BG_ALPHA = 120;
    /** 底色圆角半径（0=直角，数值越大越圆） */
    private static readonly REWARD_BG_RADIUS = 20;
    /** 金币icon显示大小（强制缩放，不管原图分辨率） */
    private static readonly COIN_SIZE = 40;
    /** 金币数字字号 */
    private static readonly REWARD_FONT_SIZE = 32;
    /** 金币icon图片路径（放在 assets/resources/textures/ui/coin_icon.png，导入类型选texture） */
    private static readonly COIN_ICON_PATH = 'textures/ui/coin_icon';

    /** 完成按钮中心X */
    private static readonly BTN_X = 0;
    /** 完成按钮中心Y */
    private static readonly BTN_Y = -50;
    /** 完成按钮宽度 */
    private static readonly BTN_WIDTH = 140;
    /** 完成按钮高度 */
    private static readonly BTN_HEIGHT = 66;
    /** 完成按钮icon图片路径（放在 assets/resources/textures/ui/complete_btn.png，导入类型选texture） */
    private static readonly COMPLETE_BTN_ICON_PATH = 'textures/ui/complete_btn';
    /** 订单消失动画时长（秒） */
    private static readonly DISAPPEAR_DURATION = 0.5;

    // ==================== 缓存 ====================

    /** 物品图片缓存（静态，所有 OrderCard 共享） */
    private static _spriteFrameCache: Map<string, SpriteFrame> = new Map();
    /** 背景图缓存 */
    private static _bgSpriteFrame: SpriteFrame | null = null;
    /** 金币icon缓存 */
    private static _coinIconSpriteFrame: SpriteFrame | null = null;
    /** 对勾icon缓存 */
    private static _checkIconSpriteFrame: SpriteFrame | null = null;
    /** 完成按钮icon缓存 */
    private static _completeBtnIconSpriteFrame: SpriteFrame | null = null;
    /** NPC序列帧缓存（静态，所有 OrderCard 共享，key=npcId，value=SpriteFrame[]） */
    private static _npcFramesCache: Map<string, SpriteFrame[]> = new Map();

    /** 所有NPC的ID列表（7个，对应 textures/npc/ 下的7个文件夹） */
    public static readonly NPC_IDS: string[] = ['npc_01', 'npc_02', 'npc_03', 'npc_04', 'npc_05', 'npc_06', 'npc_07'];

    /**
     * 后台预加载所有NPC的第一帧（游戏启动时调用，避免订单显示时才加载第一帧导致空白）
     * 只预加载第一帧，不加载所有帧（197MB全部预加载会导致启动很慢）
     */
    public static preloadAllNPCs(): void {
        for (const npcId of OrderCard.NPC_IDS) {
            OrderCard.loadNPCFirstFrame(npcId, () => {});
        }
        console.log('[OrderCard] preloading all NPC first frames in background...');
    }

    /**
     * 加载NPC第一帧（单独加载 first.png，用于快速显示，不需要等所有帧加载完成）
     * 三重容错：SpriteFrame → Texture2D+new SpriteFrame → ${path}/texture
     */
    private static loadNPCFirstFrame(npcId: string, callback: (sf: SpriteFrame | null) => void): void {
        const path = `textures/npc/${npcId}/first`;
        // 方式1：直接加载 SpriteFrame（图片导入类型为sprite-frame时）
        resources.load(path, SpriteFrame, (err, sf) => {
            if (!err && sf) {
                console.log(`[OrderCard] NPC ${npcId} first frame loaded (SpriteFrame)`);
                callback(sf);
                return;
            }
            // 方式2：加载 Texture2D，手动创建 SpriteFrame（图片导入类型为texture时）
            resources.load(path, Texture2D, (err2, texture) => {
                if (!err2 && texture) {
                    const newSF = new SpriteFrame();
                    newSF.texture = texture;
                    console.log(`[OrderCard] NPC ${npcId} first frame loaded (Texture2D)`);
                    callback(newSF);
                    return;
                }
                // 方式3：尝试子路径 ${path}/texture（Cocos Creator 3.x 某些版本需要）
                resources.load(`${path}/texture`, Texture2D, (err3, texture2) => {
                    if (!err3 && texture2) {
                        const newSF2 = new SpriteFrame();
                        newSF2.texture = texture2;
                        console.log(`[OrderCard] NPC ${npcId} first frame loaded (subpath)`);
                        callback(newSF2);
                        return;
                    }
                    console.warn(`[OrderCard] NPC ${npcId} first frame NOT found: ${path}`);
                    callback(null);
                });
            });
        });
    }

    // ==================== 实例字段 ====================

    private _orderId: string = '';
    private _bgSprite: Sprite | null = null;
    private _npcNode: Node | null = null;
    private _npcSprite: Sprite | null = null;
    private _npcFrames: SpriteFrame[] = [];
    private _npcFrameIndex: number = 0;
    private _npcAnimTimer: number | null = null;
    private _currentNPCId: string = '';
    private _itemsContainer: Node | null = null;
    private _itemSlots: { sprite: Sprite; checkMark: Node }[] = [];
    private _rewardLabel: Label | null = null;
    private _completeBtnNode: Node | null = null;
    private _onComplete: (() => void) | null = null;

    constructor() {
        this.node = new Node('OrderCard');
        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(OrderCard.CARD_WIDTH, OrderCard.CARD_HEIGHT);
        transform.setAnchorPoint(0.5, 0.5);

        this.buildNPC();
        this.buildBackground();
        this.buildItemsContainer();
        this.buildReward();
        this.buildCompleteButton();
    }

    // ==================== UI 构建 ====================

    /**
     * 加载金币icon图片（静态缓存 + 子路径/主路径双重容错）
     */
    private loadCoinIcon(sprite: Sprite): void {
        if (OrderCard._coinIconSpriteFrame) {
            sprite.spriteFrame = OrderCard._coinIconSpriteFrame;
            return;
        }

        const path = OrderCard.COIN_ICON_PATH;
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) {
                    onFail();
                    return;
                }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    OrderCard._coinIconSpriteFrame = sf;
                    if (sprite && sprite.node && sprite.node.isValid) {
                        sprite.spriteFrame = sf;
                    }
                }
            });
        };

        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn(`[OrderCard] 金币icon加载失败: ${path}，请将图片放入 assets/resources/textures/ui/coin_icon.png`);
            });
        });
    }

    /**
     * 加载对勾icon图片（静态缓存 + 子路径/主路径双重容错）
     */
    private loadCheckIcon(sprite: Sprite): void {
        if (OrderCard._checkIconSpriteFrame) {
            sprite.spriteFrame = OrderCard._checkIconSpriteFrame;
            return;
        }

        const path = OrderCard.CHECK_ICON_PATH;
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) {
                    onFail();
                    return;
                }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    OrderCard._checkIconSpriteFrame = sf;
                    if (sprite && sprite.node && sprite.node.isValid) {
                        sprite.spriteFrame = sf;
                    }
                }
            });
        };

        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn(`[OrderCard] 对勾icon加载失败: ${path}，请将图片放入 assets/resources/textures/ui/check_icon.png`);
            });
        });
    }

    /**
     * 加载完成按钮icon图片（静态缓存 + 子路径/主路径双重容错）
     */
    private loadCompleteBtnIcon(sprite: Sprite): void {
        if (OrderCard._completeBtnIconSpriteFrame) {
            sprite.spriteFrame = OrderCard._completeBtnIconSpriteFrame;
            return;
        }

        const path = OrderCard.COMPLETE_BTN_ICON_PATH;
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) {
                    onFail();
                    return;
                }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    OrderCard._completeBtnIconSpriteFrame = sf;
                    if (sprite && sprite.node && sprite.node.isValid) {
                        sprite.spriteFrame = sf;
                    }
                }
            });
        };

        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn(`[OrderCard] 完成按钮icon加载失败: ${path}，请将图片放入 assets/resources/textures/ui/complete_btn.png`);
            });
        });
    }

    /**
     * 完成按钮呼吸动画（一直缩小放大）
     */
    private startBtnPulse(): void {
        if (!this._completeBtnNode) return;
        // 先停止之前的动画
        tween(this._completeBtnNode).stop();
        // 呼吸动画：放大到1.15，缩小到0.85，循环
        tween(this._completeBtnNode)
            .repeatForever(
                tween()
                    .to(0.6, { scale: { x: 1.15, y: 1.15, z: 1 } as any })
                    .to(0.6, { scale: { x: 0.85, y: 0.85, z: 1 } as any })
            )
            .start();
    }

    /** 层1：卡片背景 */
    private buildBackground(): void {
        const bgNode = new Node('Bg');
        const bgTransform = bgNode.addComponent(UITransform);
        bgTransform.setContentSize(OrderCard.CARD_WIDTH, OrderCard.CARD_HEIGHT);
        bgTransform.setAnchorPoint(0.5, 0.5);
        bgNode.setPosition(0, 0, 0);

        this._bgSprite = bgNode.addComponent(Sprite);
        this._bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._bgSprite.type = Sprite.Type.SIMPLE;

        bgNode.setParent(this.node);
        this.loadBackground();
    }

    /** 层2：NPC形象（PNG序列帧动画） */
    private buildNPC(): void {
        this._npcNode = new Node('NPC');
        const transform = this._npcNode.addComponent(UITransform);
        transform.setContentSize(OrderCard.NPC_SIZE, OrderCard.NPC_SIZE);
        transform.setAnchorPoint(0.5, 0.5);
        this._npcNode.setPosition(OrderCard.NPC_X, OrderCard.NPC_Y, 0);

        // Sprite：CUSTOM模式，强制缩放到 NPC_SIZE
        this._npcSprite = this._npcNode.addComponent(Sprite);
        this._npcSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._npcSprite.type = Sprite.Type.SIMPLE;

        this._npcNode.setParent(this.node);
    }

    /** 层3+4：物品容器 */
    private buildItemsContainer(): void {
        this._itemsContainer = new Node('ItemsContainer');
        const transform = this._itemsContainer.addComponent(UITransform);
        transform.setContentSize(OrderCard.CARD_WIDTH, OrderCard.ITEM_SIZE + 40);
        transform.setAnchorPoint(0.5, 0.5);
        this._itemsContainer.setPosition(0, OrderCard.ITEM_CONTAINER_Y, 0);
        this._itemsContainer.setParent(this.node);
    }

    /** 层5：金额区 */
    private buildReward(): void {
        const rewardNode = new Node('Reward');
        const transform = rewardNode.addComponent(UITransform);
        transform.setContentSize(OrderCard.REWARD_WIDTH, OrderCard.REWARD_HEIGHT);
        transform.setAnchorPoint(0.5, 0.5);
        rewardNode.setPosition(OrderCard.REWARD_X, OrderCard.REWARD_Y, 0);

        // 半透明圆角矩形底色
        const bgG = rewardNode.addComponent(Graphics);
        bgG.fillColor = new Color(60, 40, 20, OrderCard.REWARD_BG_ALPHA);
        bgG.roundRect(
            -OrderCard.REWARD_WIDTH / 2,
            -OrderCard.REWARD_HEIGHT / 2,
            OrderCard.REWARD_WIDTH,
            OrderCard.REWARD_HEIGHT,
            OrderCard.REWARD_BG_RADIUS
        );
        bgG.fill();

        // 金币icon（图片）
        const coinNode = new Node('CoinIcon');
        const coinTransform = coinNode.addComponent(UITransform);
        coinTransform.setContentSize(OrderCard.COIN_SIZE, OrderCard.COIN_SIZE);
        coinTransform.setAnchorPoint(0.5, 0.5);
        coinNode.setPosition(-OrderCard.REWARD_WIDTH / 2 + OrderCard.COIN_SIZE / 2 + 10, 0, 0);
        const coinSprite = coinNode.addComponent(Sprite);
        coinSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        coinSprite.type = Sprite.Type.SIMPLE;
        coinNode.setParent(rewardNode);
        this.loadCoinIcon(coinSprite);

        // 金币数字 "+36"，白色字体，棕色描边
        const labelNode = new Node('RewardLabel');
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(OrderCard.REWARD_WIDTH - OrderCard.COIN_SIZE - 24, OrderCard.REWARD_HEIGHT);
        labelTransform.setAnchorPoint(0, 0.5);
        labelNode.setPosition(-OrderCard.REWARD_WIDTH / 2 + OrderCard.COIN_SIZE + 16, 0, 0);
        this._rewardLabel = labelNode.addComponent(Label);
        this._rewardLabel.fontSize = OrderCard.REWARD_FONT_SIZE;
        this._rewardLabel.lineHeight = OrderCard.REWARD_FONT_SIZE + 2;
        this._rewardLabel.color = new Color(255, 255, 255, 255);
        this._rewardLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this._rewardLabel.verticalAlign = Label.VerticalAlign.CENTER;
        // 棕色描边
        this._rewardLabel.isOutline = true;
        this._rewardLabel.outlineColor = new Color(120, 70, 20, 255);
        this._rewardLabel.outlineWidth = 2;
        labelNode.setParent(rewardNode);

        rewardNode.setParent(this.node);
    }

    /** 层6：完成按钮 */
    private buildCompleteButton(): void {
        this._completeBtnNode = new Node('CompleteBtn');
        const transform = this._completeBtnNode.addComponent(UITransform);
        transform.setContentSize(OrderCard.BTN_WIDTH, OrderCard.BTN_HEIGHT);
        transform.setAnchorPoint(0.5, 0.5);
        this._completeBtnNode.setPosition(OrderCard.BTN_X, OrderCard.BTN_Y, 0);

        // 按钮icon图片（强制缩放到BTN_WIDTH x BTN_HEIGHT）
        const btnSprite = this._completeBtnNode.addComponent(Sprite);
        btnSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        btnSprite.type = Sprite.Type.SIMPLE;
        this.loadCompleteBtnIcon(btnSprite);

        this._completeBtnNode.setParent(this.node);
        this._completeBtnNode.active = false;

        this._completeBtnNode.on(Node.EventType.TOUCH_END, this.onCompleteClick, this);
    }

    /**
     * 获取订单ID
     */
    public getOrderId(): string {
        return this._orderId;
    }

    /**
     * 获取卡片的世界坐标（用于物品飞行目标位置）
     */
    public getWorldPosition(): Vec3 {
        return this.node.getWorldPosition();
    }

    /**
     * 播放缩放消失动画（物品飞到后调用，动画完成后执行callback）
     */
    public playDisappearAnimation(callback: () => void): void {
        if (!this.node || !this.node.isValid) {
            callback();
            return;
        }
        // 用数值对象tween，在onUpdate里手动设置scale，避免直接tween Vec3属性的兼容性问题
        const scaleObj = { s: 1 };
        tween(scaleObj)
            .to(OrderCard.DISAPPEAR_DURATION, { s: 0.05 }, {
                onUpdate: (target: any, ratio: number) => {
                    if (this.node && this.node.isValid) {
                        this.node.setScale(target.s, target.s, 1);
                    }
                }
            })
            .call(() => {
                if (this.node && this.node.isValid) {
                    // 立即从父节点移除并销毁，避免 refreshAll 重建时旧卡片"重新放大"闪烁
                    this.node.removeFromParent();
                    this.node.destroy();
                }
                callback();
            })
            .start();
    }
    // ==================== 数据设置 ====================

    /**
     * 设置订单数据并刷新显示
     */
    public setup(order: OrderData, itemStatus: OrderItemReady[], status: OrderStatus, onComplete: () => void): void {
        this._orderId = order.id;
        this._onComplete = onComplete;

        // NPC序列帧动画
        this.playNPCAnimation(order.npcId);

        // 金额
        if (this._rewardLabel) {
            this._rewardLabel.string = `+${order.reward}`;
        }

        // 物品
        this.buildItemSlots(order.items.length);
        for (let i = 0; i < order.items.length; i++) {
            const req = order.items[i];
            const ready = itemStatus[i]?.ready ?? false;
            this.updateItemSlot(i, req.itemId, ready);
        }

        // 完成按钮
        if (this._completeBtnNode) {
            const showBtn = (status === OrderStatus.COMPLETE);
            this._completeBtnNode.active = showBtn;
            if (showBtn) { this.startBtnPulse(); }
        }
    }

    /**
     * 构建物品槽位（1-3个，并排居中）
     */
    private buildItemSlots(count: number): void {
        // 清理旧槽位
        for (const slot of this._itemSlots) {
            // 销毁slotNode（会自动销毁物品节点）
            if (slot.sprite.node && slot.sprite.node.parent && slot.sprite.node.parent.isValid) {
                slot.sprite.node.parent.destroy();
            }
            // 销毁对勾节点（在物品容器层级，需要单独销毁）
            if (slot.checkMark && slot.checkMark.isValid) {
                slot.checkMark.destroy();
            }
        }
        this._itemSlots = [];

        if (!this._itemsContainer) return;

        // 计算起始X（居中排列）
        const totalWidth = count * OrderCard.ITEM_SIZE + (count - 1) * OrderCard.ITEM_SPACING;
        const startX = -totalWidth / 2 + OrderCard.ITEM_SIZE / 2;

        for (let i = 0; i < count; i++) {
            const slotNode = new Node(`ItemSlot_${i}`);
            const slotTransform = slotNode.addComponent(UITransform);
            slotTransform.setContentSize(OrderCard.ITEM_SIZE, OrderCard.ITEM_SIZE + 40);
            slotTransform.setAnchorPoint(0.5, 0.5);
            slotNode.setPosition(startX + i * (OrderCard.ITEM_SIZE + OrderCard.ITEM_SPACING), 0, 0);
            slotNode.setParent(this._itemsContainer);

            // 物品Sprite
            const spriteNode = new Node('ItemSprite');
            const spriteTransform = spriteNode.addComponent(UITransform);
            spriteTransform.setContentSize(OrderCard.ITEM_SIZE, OrderCard.ITEM_SIZE);
            spriteTransform.setAnchorPoint(0.5, 0.5);
            spriteNode.setPosition(0, OrderCard.ITEM_INNER_Y, 0);
            const sprite = spriteNode.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            spriteNode.setParent(slotNode);

            // 对勾（物品下方）
            const checkNode = new Node('CheckMark');
            const checkTransform = checkNode.addComponent(UITransform);
            checkTransform.setContentSize(OrderCard.CHECK_SIZE, OrderCard.CHECK_SIZE);
            checkTransform.setAnchorPoint(0.5, 0.5);
            checkNode.setPosition(slotNode.position.x, OrderCard.CHECK_OFFSET_Y, 0);
            const checkSprite = checkNode.addComponent(Sprite);
            checkSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            checkSprite.type = Sprite.Type.SIMPLE;
            checkNode.setParent(this._itemsContainer);
            checkNode.active = false;
            this.loadCheckIcon(checkSprite);

            this._itemSlots.push({ sprite, checkMark: checkNode });
        }

        // 所有对勾移到最后（在所有slotNode之后，层级最高，不会被物品盖住）
        for (const slot of this._itemSlots) {
            if (slot.checkMark && slot.checkMark.parent) {
                slot.checkMark.setSiblingIndex(slot.checkMark.parent.children.length - 1);
            }
        }
    }

    /**
     * 更新单个物品槽位的图片和对勾状态
     */
    private updateItemSlot(index: number, itemId: string, ready: boolean): void {
        const slot = this._itemSlots[index];
        if (!slot) return;

        // 对勾
        slot.checkMark.active = ready;

        // 加载物品图片
        this.loadItemImage(itemId, slot.sprite);
    }

    // ==================== NPC 序列帧动画 ====================

    /**
     * 加载NPC序列帧（从 textures/npc/{npcId}/ 文件夹加载所有PNG，按文件名排序）
     */
    private static loadNPCFrames(npcId: string, callback: (frames: SpriteFrame[]) => void): void {
        const cached = OrderCard._npcFramesCache.get(npcId);
        if (cached) {
            callback(cached);
            return;
        }

        const path = `textures/npc/${npcId}`;
        resources.loadDir(path, Texture2D, (err, textures) => {
            if (err || !textures || textures.length === 0) {
                console.warn(`[OrderCard] NPC frames not found: ${path}，请将PNG序列放入该文件夹`);
                callback([]);
                return;
            }
            // 按文件名排序（01.png, 02.png, ...）
            textures.sort((a, b) => a.name.localeCompare(b.name));
            // 过滤掉 first.png（第一帧占位图，不参与动画播放）
            const filteredTextures = textures.filter(t => t.name !== 'first');
            const frames = filteredTextures.map(tex => {
                const sf = new SpriteFrame();
                sf.texture = tex;
                return sf;
            });
            OrderCard._npcFramesCache.set(npcId, frames);
            console.log(`[OrderCard] NPC ${npcId} loaded: ${frames.length} frames`);
            callback(frames);
        });
    }

    /**
     * 播放NPC序列帧动画
     */
    private playNPCAnimation(npcId: string): void {
        // 同一个NPC重复调用时不重启，避免闪烁
        if (npcId === this._currentNPCId && this._npcAnimTimer !== null) {
            return;
        }

        this.stopNPCAnimation();

        if (!npcId || !this._npcSprite) return;

        this._currentNPCId = npcId;

        // 先加载第一帧，立即显示（不需要等所有帧加载完成，解决NPC出现慢的问题）
        OrderCard.loadNPCFirstFrame(npcId, (firstFrame) => {
            if (firstFrame && this._npcSprite && this._npcSprite.node && this._npcSprite.node.isValid) {
                this._npcSprite.spriteFrame = firstFrame;
            }
        });

        // 后台加载所有帧，加载完成后开始播放动画
        OrderCard.loadNPCFrames(npcId, (frames) => {
            if (frames.length === 0 || !this._npcSprite || !this._npcSprite.node || !this._npcSprite.node.isValid) return;

            this._npcFrames = frames;
            this._npcFrameIndex = 0;
            this._npcSprite.spriteFrame = frames[0];

            // 多帧才启动定时器，单帧直接显示
            if (frames.length > 1) {
                this._npcAnimTimer = window.setInterval(() => {
                    this._npcFrameIndex = (this._npcFrameIndex + 1) % frames.length;
                    if (this._npcSprite && this._npcSprite.node && this._npcSprite.node.isValid) {
                        this._npcSprite.spriteFrame = frames[this._npcFrameIndex];
                    }
                }, OrderCard.NPC_FRAME_INTERVAL);
            }
        });
    }

    /**
     * 停止NPC动画并清理定时器
     */
    private stopNPCAnimation(): void {
        if (this._npcAnimTimer !== null) {
            clearInterval(this._npcAnimTimer);
            this._npcAnimTimer = null;
        }
        this._npcFrames = [];
        this._npcFrameIndex = 0;
    }

    // ==================== 图片加载 ====================

    /** 加载卡片背景图 */
    private loadBackground(): void {
        if (OrderCard._bgSpriteFrame) {
            if (this._bgSprite) {
                this._bgSprite.spriteFrame = OrderCard._bgSpriteFrame;
            }
            return;
        }

        const path = 'textures/ui/order_card_bg';
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) {
                    onFail();
                    return;
                }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    OrderCard._bgSpriteFrame = sf;
                    if (this._bgSprite) {
                        this._bgSprite.spriteFrame = sf;
                    }
                }
            });
        };

        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn('[OrderCard] 背景图加载失败: textures/ui/order_card_bg，将使用透明背景');
            });
        });
    }

    /**
     * 加载物品图片（和 Item.ts 相同的逻辑：静态缓存 + 子路径/主路径双重容错）
     */
    private loadItemImage(itemId: string, sprite: Sprite): void {
        const path = `textures/items/${itemId}`;

        const cached = OrderCard._spriteFrameCache.get(path);
        if (cached) {
            sprite.spriteFrame = cached;
            return;
        }

        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) {
                    onFail();
                    return;
                }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    OrderCard._spriteFrameCache.set(path, sf);
                    // 防止异步加载完成时槽位已被重建
                    if (sprite && sprite.node && sprite.node.isValid) {
                        sprite.spriteFrame = sf;
                    }
                }
            });
        };

        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn(`[OrderCard] 物品图加载失败: ${path}`);
            });
        });
    }

    // ==================== 交互 ====================

    private onCompleteClick(): void {
        if (!this._completeBtnNode || !this._completeBtnNode.active) return;
        this._completeBtnNode.active = false; // 点击后按钮消失
        if (this._onComplete) {
            this._onComplete();
        }
    }

    // ==================== 清理 ====================

    public dispose(): void {
        this.stopNPCAnimation();
        if (this.node && this.node.isValid) {
            this.node.destroy();
        }
        this._itemSlots = [];
    }
}
