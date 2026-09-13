import { _decorator, Component, Node, Vec2, Vec3, EventTouch, director, Camera, Sprite, SpriteFrame, Texture2D, UITransform, resources, tween, Color } from 'cc';
import { ItemManager } from './ItemManager';
import { ItemData } from './ItemData';
import { Cell } from './Cell';
import { getGameContext } from './core/GameContext';
import { EventManager } from './core/EventManager';
import { BoardManager } from './BoardManager';
import { OrderManager } from './order/OrderManager';

const { ccclass, property } = _decorator;

/**
 * 物品组件
 * 仅负责物品节点的表现、拖拽交互以及与 ItemManager 通信
 * 不处理合成规则等业务逻辑
 *
 * 显示方式：Sprite 图片，从 resources/textures/items/ 动态加载
 * 图片命名：与 itemId 一致，如 bp_c1_lv7.png
 * 显示大小：与格子同大（读取 BoardManager.CELL_SIZE），不管原图分辨率都缩放到该尺寸
 */
@ccclass('Item')
export class Item extends Component {
    @property({ type: Number })
    public dragZOffset: number = 10;

    @property({ type: Number })
    public dragThreshold: number = 10;

    /**
     * 已加载的 SpriteFrame 缓存（静态，所有 Item 共享）
     * key: resources 加载路径，value: SpriteFrame
     */
    private static _spriteFrameCache: Map<string, SpriteFrame> = new Map();

    /**
     * 订单对勾icon的 SpriteFrame 缓存（静态，所有 Item 共享，只加载一次）
     */
    private static _orderCheckSpriteFrame: SpriteFrame | null = null;

    private _data: ItemData | null = null;

    /**
     * 物品纯数据，由 ItemManager 创建并关联
     */
    public get data(): ItemData | null {
        return this._data;
    }

    public set data(value: ItemData | null) {
        this._data = value;
        this.refreshVisual();
    }

    /**
     * 拖拽开始时的原始列，用于回弹
     */
    public originCol: number = -1;

    /**
     * 拖拽开始时的原始行，用于回弹
     */
    public originRow: number = -1;

    private _dragOffset: Vec3 = new Vec3();
    private _originLocalZ: number = 0;
    private _originalSiblingIndex: number = 0;

    private _startScreenPos: Vec2 | null = null;
    private _isDragging: boolean = false;

    /** Sprite 组件引用，用于设置图片 */
    private _sprite: Sprite | null = null;

    // ==================== 物品显示大小 ====================
    /**
     * 物品图片显示大小（像素）——独立于格子大小，单独调整格子里物品的显示尺寸。
     * 默认 145（与格子 BoardManager.CELL_SIZE 等大，保持原有表现）。
     * 改小：物品在格子内缩小并居中；改大：物品超出格子。
     * 说明：只影响物品图片本身的显示大小，不影响触摸/拖拽命中区域（命中区域始终为整格 CELL_SIZE，
     *      不会出现点不到的缝隙），也不影响对勾/闪电/星星等图标（它们各有独立的大小与偏移常量）。
     */
    private static readonly ITEM_SIZE = 130;

    // ==================== 发射器星星特效 ====================
    // ==================== 发射器星星特效 ====================
    /** 发射器星星序列帧路径 */
    private static readonly STAR_EFFECT_PATH = 'textures/effect/generator_star';
    /** 星星特效帧率（FPS），越大播放越快 */
    private static readonly STAR_FPS = 12;
    /** 星星特效整体缩放 */
    private static readonly STAR_SCALE = 1.0;
    /** 星星特效Y偏移（相对于发射器中心，负值=在下方） */
    private static readonly STAR_OFFSET_Y = -30;

    private _starEffectNode: Node | null = null;
    private _starSprite: Sprite | null = null;
    private _starFrames: SpriteFrame[] = [];
    private _starFrameIndex: number = 0;
    private _starLastTime: number = 0;
    private _starEffectStarted: boolean = false;

    // ==================== 选中特效 ====================
    /** 选中特效序列帧路径 */
    private static readonly SELECTED_EFFECT_PATH = 'textures/effect/item_selected';
    /** 选中特效帧率（FPS） */
    private static readonly SELECTED_FPS = 15;
    /** 选中特效显示大小（像素），直接控制，不随格子大小变化 */
    private static readonly SELECTED_SIZE = 170;

    private _selectedEffectNode: Node | null = null;
    private _selectedSprite: Sprite | null = null;
    private _selectedFrames: SpriteFrame[] = [];
    private _selectedFrameIndex: number = 0;
    private _selectedLastTime: number = 0;
    private _selectedEffectLoaded: boolean = false;

    // ==================== 长按连续发射 ====================
    /** 长按触发延迟（毫秒），按住多久后开始连续发射 */
    private static readonly LONG_PRESS_DELAY = 300;
    /** 连续发射间隔（毫秒） */
    private static readonly FIRE_INTERVAL = 100;

    // ==================== 发射器闪电标志 ====================
    /** 闪电标志显示大小（像素） */
    private static readonly LIGHTNING_SIZE = 50;
    /** 闪电标志透明度（0-255，255=完全不透明） */
    private static readonly LIGHTNING_OPACITY = 200;
    /** 闪电标志X偏移（相对于物品中心，正值=向右，负值=向左） */
    private static readonly LIGHTNING_OFFSET_X = 45;
    /** 闪电标志Y偏移（相对于物品中心，正值=向上，负值=向下） */
    private static readonly LIGHTNING_OFFSET_Y = -45;
    /** x1倍率闪电路径 */
    private static readonly LIGHTNING_X1_PATH = 'textures/ui/lightning_x1';
    /** x2倍率闪电路径 */
    private static readonly LIGHTNING_X2_PATH = 'textures/ui/lightning_x2';
    /** x4倍率闪电路径 */
    private static readonly LIGHTNING_X4_PATH = 'textures/ui/lightning_x4';

    // ==================== 订单对勾标志（棋盘物品命中订单需求时显示绿色对勾） ====================
    /** 订单对勾icon图片路径（复用订单卡片的 check_icon，放在 assets/resources/textures/ui/check_icon.png，导入类型选 texture） */
    private static readonly ORDER_CHECK_ICON_PATH = 'textures/ui/check_icon';
    /** 订单对勾显示大小（像素）——改这里调整 icon 尺寸 */
    private static readonly ORDER_CHECK_SIZE = 80;
    /** 订单对勾 X 偏移（相对物品中心，正值=向右，负值=向左）——改这里调整水平位置 */
    private static readonly ORDER_CHECK_OFFSET_X = 30;
    /** 订单对勾 Y 偏移（相对物品中心，正值=向上，负值=向下）——改这里调整垂直位置 */
    private static readonly ORDER_CHECK_OFFSET_Y = -40;
    /** 订单对勾透明度（0-255，255=完全不透明） */
    private static readonly ORDER_CHECK_OPACITY = 255;

    private _longPressTimer: number | null = null;
    private _fireTimer: number | null = null;
    private _isLongPressFiring: boolean = false;

    private _lightningNode: Node | null = null;
    private _lightningSprite: Sprite | null = null;
    private _lightningFrames: Map<number, SpriteFrame> = new Map();
    private _onMultiplierChangedBound: ((multiplier: number) => void) | null = null;

    /** 订单对勾子节点（懒创建，命中订单需求时显示） */
    private _orderCheckNode: Node | null = null;
    /** 订单对勾 Sprite 组件 */
    private _orderCheckSprite: Sprite | null = null;
    /** 订单变化事件回调引用（用于解绑） */
    private _onOrderChangedBound: (() => void) | null = null;
    onLoad() {
        this.registerTouchEvents();
        this.createVisual();
        // 监听倍率变化，切换闪电标志
        this._onMultiplierChangedBound = (multiplier: number) => {
            this.updateLightningIcon(multiplier);
        };
        EventManager.instance.on(EventManager.MULTIPLIER_CHANGED, this._onMultiplierChangedBound);
        // 监听订单变化，刷新订单对勾标志（订单完成/补充/命中前移导致需求集合变化）
        this._onOrderChangedBound = () => {
            this.updateOrderCheckIcon();
        };
        EventManager.instance.on(EventManager.ORDER_CHANGED, this._onOrderChangedBound);
    }

    onDestroy() {
        this.unregisterTouchEvents();
        this.stopLongPress();
        // 取消倍率变化监听
        if (this._onMultiplierChangedBound) {
            EventManager.instance.off(EventManager.MULTIPLIER_CHANGED, this._onMultiplierChangedBound);
            this._onMultiplierChangedBound = null;
        }
        // 清理星星特效
        if (this._starEffectNode && this._starEffectNode.isValid) {
            this._starEffectNode.destroy();
        }
        this._starEffectNode = null;
        this._starSprite = null;
        this._starFrames = [];
        // 清理选中特效
        if (this._selectedEffectNode && this._selectedEffectNode.isValid) {
            this._selectedEffectNode.destroy();
        }
        this._selectedEffectNode = null;
        this._selectedSprite = null;
        this._selectedFrames = [];
        // 清理闪电标志
        if (this._lightningNode && this._lightningNode.isValid) {
            this._lightningNode.destroy();
        }
        this._lightningNode = null;
        this._lightningSprite = null;
        this._lightningFrames.clear();
        // 取消订单变化监听
        if (this._onOrderChangedBound) {
            EventManager.instance.off(EventManager.ORDER_CHANGED, this._onOrderChangedBound);
            this._onOrderChangedBound = null;
        }
        // 清理订单对勾标志
        if (this._orderCheckNode && this._orderCheckNode.isValid) {
            this._orderCheckNode.destroy();
        }
        this._orderCheckNode = null;
        this._orderCheckSprite = null;
    }

    /**
     * 创建物品视觉：根节点 UITransform 固定为格子大小（作为触摸命中区域）+ 独立子节点承载物品图片 Sprite
     * 物品图片 Sprite.sizeMode = CUSTOM，强制缩放到 ITEM_SIZE（可独立于格子大小调整）
     */
    private createVisual(): void {
        // 根节点 UITransform：固定为格子大小，作为触摸/拖拽命中区域（不随物品显示大小变化，保证整格可点、无死角缝隙）
        const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        transform.setContentSize(BoardManager.CELL_SIZE, BoardManager.CELL_SIZE);
        transform.setAnchorPoint(0.5, 0.5);

        // 物品图片挂在独立子节点上，显示大小由 ITEM_SIZE 常量单独控制（与命中区域解耦，居中于格子）
        const spriteNode = new Node('ItemSprite');
        const spriteTransform = spriteNode.addComponent(UITransform);
        spriteTransform.setAnchorPoint(0.5, 0.5);
        spriteTransform.setContentSize(Item.ITEM_SIZE, Item.ITEM_SIZE);

        // Sprite：CUSTOM 模式，不管原图分辨率都缩放到 ITEM_SIZE
        this._sprite = spriteNode.addComponent(Sprite);
        this._sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._sprite.type = Sprite.Type.SIMPLE;

        spriteNode.setPosition(0, 0, 0);
        spriteNode.setParent(this.node);

        // 如果创建时已有数据，立即刷新视觉（包括图片和特效）
        if (this._data) {
            this.refreshVisual();
        }
    }

    /**
     * 刷新视觉：数据变化时重新加载对应图片
     */
    private refreshVisual(): void {
        this.loadIcon();
        // 如果是发射器，启动星星特效和闪电标志（只启动一次）
        if (this._data?.isGenerator && !this._starEffectStarted) {
            this.createGeneratorStarEffect();
            this.createLightningIcon();
        }
        // 刷新订单对勾标志（物品命中当前订单需求时显示）
        this.updateOrderCheckIcon();
    }

    /**
     * 加载物品图标图片
     * 路径：resources/textures/items/{itemId}
     * 先查静态缓存，命中则直接使用；未命中则异步 resources.load
     */
    private loadIcon(): void {
        if (!this._sprite || !this._data) {
            return;
        }

        const itemId = this._data.itemId;
        const path = `textures/items/${itemId}`;

        // 先查缓存
        const cached = Item._spriteFrameCache.get(path);
        if (cached) {
            this._sprite.spriteFrame = cached;
            return;
        }

        // 加载 Texture2D（兼容图片导入类型为 texture 的情况）
        // texture 类型的图片，Texture2D 是子资源，先尝试 /texture 子路径，再尝试主路径
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) {
                    onFail();
                    return;
                }
                if (texture) {
                    const spriteFrame = new SpriteFrame();
                    spriteFrame.texture = texture;
                    Item._spriteFrameCache.set(path, spriteFrame);
                    if (this._sprite && this._data && this._data.itemId === itemId) {
                        this._sprite.spriteFrame = spriteFrame;
                    }
                }
            });
        };

        // 先尝试子资源路径 text/items/xxx/texture，失败再试主路径
        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn(`[Item] 图片加载失败: ${path}（已尝试子路径和主路径）。请在 Cocos Creator 编辑器里右键 resources 目录 → 重新导入，然后重启预览`);
            });
        });
    }

    // ==================== 发射器星星特效 ====================

    /**
     * 创建发射器常驻循环星星特效
     * 序列帧动画，ONE+ONE 叠加混合模式（黑色底色自动消失，发光叠加）
     */
    private createGeneratorStarEffect(): void {
        if (this._starEffectStarted) return;
        this._starEffectStarted = true;

        this._starEffectNode = new Node('GeneratorStarEffect');
        const transform = this._starEffectNode.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);

        this._starSprite = this._starEffectNode.addComponent(Sprite);
        this._starSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._starSprite.type = Sprite.Type.SIMPLE;
        // 透明PNG用默认混合模式（SRC_ALPHA / ONE_MINUS_SRC_ALPHA），不需要叠加

        this._starEffectNode.setScale(Item.STAR_SCALE, Item.STAR_SCALE, 1);
        this._starEffectNode.setPosition(0, Item.STAR_OFFSET_Y, 0);
        this._starEffectNode.setParent(this.node);

        // 加载序列帧（用 Texture2D 加载，兼容图片导入类型为 texture 的情况）
        resources.loadDir(Item.STAR_EFFECT_PATH, Texture2D, (err, textures) => {
            if (err || !textures || textures.length === 0) {
                console.warn(`[Item] 发射器星星序列帧加载失败: ${Item.STAR_EFFECT_PATH}，请将PNG序列放入该目录`);
                return;
            }
            // 按文件名排序
            textures.sort((a, b) => a.name.localeCompare(b.name));
            this._starFrames = textures.map(tex => {
                const sf = new SpriteFrame();
                sf.texture = tex;
                return sf;
            });
            this._starFrameIndex = 0;
            this._starLastTime = 0;
            if (this._starSprite) {
                this._starSprite.spriteFrame = this._starFrames[0];
            }
            console.log(`[Item] 发射器星星序列帧加载成功: ${this._starFrames.length} 帧`);
        });
    }


    // ==================== 发射器闪电标志 ====================

    /**
     * 创建发射器闪电标志（右下角，不同倍率显示不同颜色）
     */
    private createLightningIcon(): void {
        if (this._lightningNode) return;

        this._lightningNode = new Node('LightningIcon');
        const transform = this._lightningNode.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);
        transform.setContentSize(Item.LIGHTNING_SIZE, Item.LIGHTNING_SIZE);

        this._lightningSprite = this._lightningNode.addComponent(Sprite);
        this._lightningSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._lightningSprite.type = Sprite.Type.SIMPLE;
        this._lightningSprite.color = new Color(255, 255, 255, Item.LIGHTNING_OPACITY);

        this._lightningNode.setPosition(Item.LIGHTNING_OFFSET_X, Item.LIGHTNING_OFFSET_Y, 0);
        this._lightningNode.setParent(this.node);

        // 获取当前倍率，显示对应图标
        const currentMultiplier = getGameContext()?.gameManager?.currentMultiplier ?? 1;
        this.updateLightningIcon(currentMultiplier);
    }

    /**
     * 根据倍率切换闪电标志图标
     * @param multiplier 当前倍率（1/2/4）
     */
    private updateLightningIcon(multiplier: number): void {
        if (!this._lightningSprite || !this._lightningNode) return;

        // 已缓存直接使用
        const cached = this._lightningFrames.get(multiplier);
        if (cached) {
            this._lightningSprite.spriteFrame = cached;
            return;
        }

        // 根据倍率选择路径
        let path = Item.LIGHTNING_X1_PATH;
        if (multiplier === 2) path = Item.LIGHTNING_X2_PATH;
        else if (multiplier === 4) path = Item.LIGHTNING_X4_PATH;

        // 加载 Texture2D（兼容图片导入类型为 texture 的情况）
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) { onFail(); return; }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    this._lightningFrames.set(multiplier, sf);
                    if (this._lightningSprite && this._lightningNode && this._lightningNode.isValid) {
                        this._lightningSprite.spriteFrame = sf;
                    }
                }
            });
        };

        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn(`[Item] 闪电标志加载失败: ${path}`);
            });
        });
    }

    // ==================== 订单对勾标志 ====================

    /**
     * 刷新订单对勾标志：当前物品命中任意订单需求时显示绿色对勾，否则隐藏
     *
     * 触发时机：
     * 1. 物品数据变化（生成 / 合成产生新物品）→ refreshVisual 调用
     * 2. 订单变化（ORDER_CHANGED：订单完成 / 补充 / 命中前移）→ 事件回调调用
     */
    private updateOrderCheckIcon(): void {
        if (!this.isRequiredByAnyOrder()) {
            // 不命中：若已创建则隐藏（保留节点以便复用）
            if (this._orderCheckNode) {
                this._orderCheckNode.active = false;
            }
            return;
        }
        // 命中：懒创建节点后显示
        this.ensureOrderCheckIcon();
        if (this._orderCheckNode) {
            this._orderCheckNode.active = true;
        }
    }

    /**
     * 判断当前物品是否命中任意当前订单的需求
     *
     * 规则：只要物品 itemId 出现在任一当前订单的需求列表中即命中。
     * 不看数量——棋盘上多个相同物品若都在订单需求中，每个都各自显示对勾。
     * 发射器不参与（订单需求不会为发射器）。
     */
    private isRequiredByAnyOrder(): boolean {
        const data = this._data;
        if (!data || data.isGenerator) {
            return false;
        }
        const orders = OrderManager.instance.getCurrentOrders();
        for (const order of orders) {
            for (const req of order.items) {
                if (req.itemId === data.itemId) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 懒创建订单对勾子节点（首次命中时创建，之后复用，仅切换 active）
     * 作为物品子节点，渲染在物品图片之上；尺寸/偏移由顶部 ORDER_CHECK_* 常量控制
     */
    private ensureOrderCheckIcon(): void {
        if (this._orderCheckNode) {
            return;
        }

        this._orderCheckNode = new Node('OrderCheckIcon');
        const transform = this._orderCheckNode.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);
        transform.setContentSize(Item.ORDER_CHECK_SIZE, Item.ORDER_CHECK_SIZE);

        this._orderCheckSprite = this._orderCheckNode.addComponent(Sprite);
        this._orderCheckSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._orderCheckSprite.type = Sprite.Type.SIMPLE;
        if (Item.ORDER_CHECK_OPACITY < 255) {
            this._orderCheckSprite.color = new Color(255, 255, 255, Item.ORDER_CHECK_OPACITY);
        }

        this._orderCheckNode.setPosition(Item.ORDER_CHECK_OFFSET_X, Item.ORDER_CHECK_OFFSET_Y, 0);
        this._orderCheckNode.setParent(this.node);

        this.loadOrderCheckIcon();
    }

    /**
     * 加载订单对勾icon图片（静态缓存 + 子路径/主路径双重容错，复用 OrderCard 的 check_icon）
     */
    private loadOrderCheckIcon(): void {
        if (!this._orderCheckSprite) {
            return;
        }
        // 已缓存直接使用（所有 Item 共享，只加载一次）
        if (Item._orderCheckSpriteFrame) {
            this._orderCheckSprite.spriteFrame = Item._orderCheckSpriteFrame;
            return;
        }

        const path = Item.ORDER_CHECK_ICON_PATH;
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) {
                    onFail();
                    return;
                }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    Item._orderCheckSpriteFrame = sf;
                    if (this._orderCheckSprite && this._orderCheckNode && this._orderCheckNode.isValid) {
                        this._orderCheckSprite.spriteFrame = sf;
                    }
                }
            });
        };

        tryLoad(`${path}/texture`, () => {
            tryLoad(path, () => {
                console.warn(`[Item] 订单对勾icon加载失败: ${path}，请将图片放入 assets/resources/textures/ui/check_icon.png`);
            });
        });
    }

    // ==================== 选中特效 ====================

    /**
     * 创建选中特效节点（懒加载，第一次选中时才创建）
     */
    private createSelectedEffect(): void {
        if (this._selectedEffectNode) return;

        this._selectedEffectNode = new Node('SelectedEffect');
        const transform = this._selectedEffectNode.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);
        transform.setContentSize(Item.SELECTED_SIZE, Item.SELECTED_SIZE);

        this._selectedSprite = this._selectedEffectNode.addComponent(Sprite);
        this._selectedSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._selectedSprite.type = Sprite.Type.SIMPLE;

        this._selectedEffectNode.setPosition(0, 0, 0);
        this._selectedEffectNode.setParent(this.node);
        this._selectedEffectNode.active = false;

        // 加载序列帧
        resources.loadDir(Item.SELECTED_EFFECT_PATH, Texture2D, (err, textures) => {
            if (err || !textures || textures.length === 0) {
                console.warn(`[Item] 选中特效序列帧加载失败: ${Item.SELECTED_EFFECT_PATH}`);
                return;
            }
            textures.sort((a, b) => a.name.localeCompare(b.name));
            this._selectedFrames = textures.map(tex => {
                const sf = new SpriteFrame();
                sf.texture = tex;
                return sf;
            });
            this._selectedFrameIndex = 0;
            this._selectedLastTime = 0;
            this._selectedEffectLoaded = true;
            if (this._selectedSprite && this._selectedEffectNode?.active) {
                this._selectedSprite.spriteFrame = this._selectedFrames[0];
            }
            console.log(`[Item] 选中特效序列帧加载成功: ${this._selectedFrames.length} 帧`);
        });
    }

    /**
     * 设置选中状态（由 ItemManager 调用）
     */
    public setSelected(selected: boolean): void {
        if (selected) {
            this.createSelectedEffect();
            if (this._selectedEffectNode) {
                this._selectedEffectNode.active = true;
                if (this._selectedEffectLoaded && this._selectedSprite && this._selectedFrames.length > 0) {
                    this._selectedSprite.spriteFrame = this._selectedFrames[0];
                    this._selectedFrameIndex = 0;
                    this._selectedLastTime = 0;
                }
            }
        } else {
            if (this._selectedEffectNode) {
                this._selectedEffectNode.active = false;
            }
        }
    }

    // ==================== 长按连续发射 ====================

    /**
     * 开始长按检测（仅已选中的发射器才启动）
     */
    private startLongPress(): void {
        if (!this._data?.isGenerator) return;
        if (!ItemManager.instance.isSelected(this.node)) return;

        this._longPressTimer = window.setTimeout(() => {
            this._isLongPressFiring = true;
            // 立即发射一次
            ItemManager.instance.fireGenerator(this.node);
            // 然后每隔 FIRE_INTERVAL 发射一次
            this._fireTimer = window.setInterval(() => {
                if (this.node && this.node.isValid) {
                    ItemManager.instance.fireGenerator(this.node);
                }
            }, Item.FIRE_INTERVAL);
        }, Item.LONG_PRESS_DELAY);
    }

    /**
     * 停止长按和连续发射
     */
    private stopLongPress(): void {
        if (this._longPressTimer !== null) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
        if (this._fireTimer !== null) {
            clearInterval(this._fireTimer);
            this._fireTimer = null;
        }
        this._isLongPressFiring = false;
    }

    /**
     * 每帧更新：驱动星星和选中特效序列帧动画循环播放
     * 使用 performance.now() 真实时间驱动，确保任何帧率(30/60/120/144)下动画速度一致
     */
    update(deltaTime: number): void {
        const now = performance.now();
        // 防止切换标签页/暂停后累积过多时间导致跳帧（最大补偿 200ms）
        const MAX_ELAPSED = 0.2;

        // 发射器星星特效
        if (this._starEffectNode && this._starFrames.length > 0) {
            if (this._starLastTime === 0) {
                this._starLastTime = now;
            }
            const starInterval = 1000.0 / Item.STAR_FPS; // 毫秒
            let elapsed = now - this._starLastTime;
            if (elapsed > MAX_ELAPSED * 1000) {
                elapsed = MAX_ELAPSED * 1000;
                this._starLastTime = now - elapsed;
            }
            while (elapsed >= starInterval) {
                elapsed -= starInterval;
                this._starLastTime += starInterval;
                this._starFrameIndex = (this._starFrameIndex + 1) % this._starFrames.length;
            }
            if (this._starSprite && this._starEffectNode.isValid) {
                this._starSprite.spriteFrame = this._starFrames[this._starFrameIndex];
            }
        }

        // 选中特效
        if (this._selectedEffectNode && this._selectedEffectNode.active && this._selectedFrames.length > 0) {
            if (this._selectedLastTime === 0) {
                this._selectedLastTime = now;
            }
            const selectedInterval = 1000.0 / Item.SELECTED_FPS; // 毫秒
            let elapsed = now - this._selectedLastTime;
            if (elapsed > MAX_ELAPSED * 1000) {
                elapsed = MAX_ELAPSED * 1000;
                this._selectedLastTime = now - elapsed;
            }
            while (elapsed >= selectedInterval) {
                elapsed -= selectedInterval;
                this._selectedLastTime += selectedInterval;
                this._selectedFrameIndex = (this._selectedFrameIndex + 1) % this._selectedFrames.length;
            }
            if (this._selectedSprite && this._selectedEffectNode.isValid) {
                this._selectedSprite.spriteFrame = this._selectedFrames[this._selectedFrameIndex];
            }
        }
    }

    private registerTouchEvents(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private unregisterTouchEvents(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private onTouchStart(event: EventTouch): void {
        // 记录触摸起点，用于区分点击和拖动
        const screenPos = event.getLocation();
        this._startScreenPos = new Vec2(screenPos.x, screenPos.y);
        this._isDragging = false;

        // 保存原始行列，用于后续回弹
        this.originCol = this.data?.col ?? -1;
        this.originRow = this.data?.row ?? -1;

        // 提升显示层级
        this._originalSiblingIndex = this.node.getSiblingIndex();
        const parent = this.node.parent;
        if (parent) {
            this.node.setSiblingIndex(parent.children.length - 1);
        }

        // 记录拖拽偏移量
        const touchWorldPos = this.screenToWorld(event.getLocation());
        this._dragOffset = Vec3.subtract(new Vec3(), this.node.worldPosition, touchWorldPos);

        // 抬高节点 Z 轴
        this._originLocalZ = this.node.position.z;
        this.node.position = new Vec3(this.node.position.x, this.node.position.y, this._originLocalZ + this.dragZOffset);

        // 启动长按检测（仅已选中的发射器才会真正启动）
        this.startLongPress();
    }

    private onTouchMove(event: EventTouch): void {
        if (!this._startScreenPos) {
            return;
        }

        const screenPos = event.getLocation();

        // 未进入拖动状态时，检查移动距离是否超过阈值
        if (!this._isDragging) {
            const dx = screenPos.x - this._startScreenPos.x;
            const dy = screenPos.y - this._startScreenPos.y;
            if (Math.sqrt(dx * dx + dy * dy) < this.dragThreshold) {
                return;
            }
            this._isDragging = true;
            // 进入拖动状态，停止长按
            this.stopLongPress();
        }

        const touchWorldPos = this.screenToWorld(event.getLocation());
        const targetWorldPos = Vec3.add(new Vec3(), touchWorldPos, this._dragOffset);
        this.node.worldPosition = targetWorldPos;
    }

    private onTouchEnd(event: EventTouch): void {
        // 停止长按和连续发射
        const wasLongPressFiring = this._isLongPressFiring;
        this.stopLongPress();

        if (this._isDragging) {
            this.finalizeDrag();
        } else if (!wasLongPressFiring) {
            // 未进入拖动状态且未触发长按，视为短按点击
            this.restoreZ();
            this.node.setSiblingIndex(this._originalSiblingIndex);
            this.handleClick();
        } else {
            // 长按结束，只恢复状态
            this.restoreZ();
            this.node.setSiblingIndex(this._originalSiblingIndex);
        }

        this._startScreenPos = null;
        this._isDragging = false;
    }

    private onTouchCancel(event: EventTouch): void {
        const wasDragging = this._isDragging;
        this.stopLongPress();

        this.restoreZ();
        this.node.setSiblingIndex(this._originalSiblingIndex);
        this._startScreenPos = null;
        this._isDragging = false;

        // 取消时如果是在拖动中，执行一次落点处理（可回到原位置或目标格）
        if (wasDragging) {
            this.finalizeDrag();
        }
    }

    private finalizeDrag(): void {
        this.restoreZ();

        // 恢复显示层级
        this.node.setSiblingIndex(this._originalSiblingIndex);

        // 根据当前物品中心所在世界坐标查询目标格子
        const boardManager = getGameContext()?.boardManager ?? null;
        let dropCell: Cell | null = null;
        if (boardManager) {
            dropCell = boardManager.getCellByWorldPos(this.node.worldPosition);
        }

        ItemManager.instance?.handleItemDrop(this.node, this.originCol, this.originRow, dropCell);
    }

    private handleClick(): void {
        const itemData = this.data;
        if (!itemData) return;

        this.playClickAnimation();
        // 所有物品都可以选中；选中状态下发射器才会发射（逻辑在 ItemManager.handleItemClick）
        ItemManager.instance.handleItemClick(this.node);
    }

    private playClickAnimation(): void {
        tween(this.node)
            .to(0.05, { scale: new Vec3(1.1, 1.1, 1) })
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    private restoreZ(): void {
        this.node.position = new Vec3(this.node.position.x, this.node.position.y, this._originLocalZ);
    }

    private screenToWorld(screenPos: Vec2): Vec3 {
        const camera = this.getMainCamera();
        if (!camera) {
            return new Vec3(screenPos.x, screenPos.y, 0);
        }
        return camera.screenToWorld(new Vec3(screenPos.x, screenPos.y, 0));
    }

    private getMainCamera(): Camera | null {
        const scene = director.getScene();
        if (!scene) {
            return null;
        }
        return scene.getComponentInChildren(Camera);
    }
}
