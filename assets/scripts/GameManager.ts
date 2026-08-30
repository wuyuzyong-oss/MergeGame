import { _decorator, Component, Node, Prefab, Vec3, Sprite, SpriteFrame, ImageAsset, UITransform, Texture2D, assetManager } from 'cc';
import { BoardManager } from './BoardManager';
import { ItemManager } from './ItemManager';
import { OrderManager } from './order/OrderManager';
import { ResourceManager } from './resource/ResourceManager';
import { EventManager } from './core/EventManager';
import { setGameContext } from './core/GameContext';
// 注意：不直接 import AccountPanel / OrderPanel，避免循环依赖
// GameManager → OrderPanel → OrderManager → GameManager
// 改用 @ccclass 注册名 + addComponent(字符串) 动态挂载

const { ccclass, property } = _decorator;

/**
 * 游戏主管理器
 * 负责统筹所有子系统，作为游戏入口
 */
@ccclass('GameManager')
export class GameManager extends Component {
    // 单例
    private static _instance: GameManager | null = null;
    public static get instance(): GameManager | null {
        return GameManager._instance;
    }

    // =========编辑器拖拽赋值节点=========
    @property({ type: Node })
    public accountPanel: Node | null = null;

    @property({ type: Node })
    public orderPanel: Node | null = null;

    @property({ type: Node })
    public boardPanel: Node | null = null;

    @property({ type: Node })
    public effectLayer: Node | null = null;

    @property({ type: Prefab })
    public itemPrefab: Prefab | null = null;

    @property({ type: ImageAsset })
    public bgTexture: ImageAsset | null = null;
    // ====================================

    private _boardManager: BoardManager | null = null;

    onLoad() {
        GameManager._instance = this;
        setGameContext(this);
        this.initialize();
        this.registerResourceEvents();
        this.exposeTestAPIs();
    }

    onDestroy() {
        GameManager._instance = null;
    }

    /**
     * 初始化所有子系统
     */
    private initialize(): void {
        console.log('GameManager initialized');

        // 校验棋盘父节点是否在编辑器赋值
        if (!this.boardPanel) {
            console.error('[GameManager] boardPanel 为空！请在编辑器把层级管理器的 BoardPanel 拖入属性框');
            return;
        }

        if (!this.itemPrefab) {
            console.error('[GameManager] itemPrefab 为空！请在编辑器把 Item.prefab 拖入属性框');
            return;
        }

        // 加载背景图
        this.setupBackground();

        // 将 BoardPanel 节点传给 BoardManager，棋盘全部渲染到此节点下
        this._boardManager = new BoardManager();
        this._boardManager.initialize(this.boardPanel);

        // 初始化物品管理器（传入 BoardManager，避免循环依赖）
        ItemManager.instance.init(this.itemPrefab, this.boardPanel, this._boardManager);

        // 生成测试物品
        this.spawnTestItems();

        // 初始化订单系统
        OrderManager.instance.init();

        // 创建 UI 节点（AccountPanel / OrderPanel / EffectLayer）
        this.setupUI();

        // 初始订单状态检测（调试用）
        this.scheduleOnce(() => {
            const results = OrderManager.instance.checkOrders();
            for (const result of results) {
                console.log(`[GameManager] Order ${result.order.id}: ${result.status}, ${result.progress}`);
            }
        }, 0.5);
    }

    /**
     * 创建全屏背景图节点，置于 Canvas 最底层
     * 优先使用编辑器属性 bgTexture，否则尝试动态加载
     */
    private setupBackground(): void {
        const canvas = this.node;

        // 创建背景节点
        const bgNode = new Node('Background');
        const bgTransform = bgNode.addComponent(UITransform);
        bgTransform.setContentSize(1080, 1920);
        bgTransform.setAnchorPoint(0.5, 0.5);

        const bgSprite = bgNode.addComponent(Sprite);
        bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        bgSprite.type = Sprite.Type.SIMPLE;

        bgNode.setParent(canvas);
        bgNode.setPosition(new Vec3(0, 0, 0));
        bgNode.setSiblingIndex(0); // 置于最底层

        if (this.bgTexture) {
            // 使用编辑器拖拽赋值的纹理
            const tex = new Texture2D();
            tex.image = this.bgTexture;
            const frame = new SpriteFrame();
            frame.texture = tex;
            bgSprite.spriteFrame = frame;
            console.log('[GameManager] Background loaded from editor property');
        } else {
            // 尝试动态加载
            this.loadBackgroundImage(bgSprite);
        }
    }

    /**
     * 动态加载背景图（备用方案）
     */
    private loadBackgroundImage(bgSprite: Sprite): void {
        assetManager.loadRemote(
            'textures/background/game_background',
            { ext: '.png' },
            (err, imageAsset: ImageAsset) => {
                if (err) {
                    console.warn('[GameManager] Background load failed:', err.message);
                    console.warn('[GameManager] Please drag game_background.png to GameManager.bgTexture in editor');
                    return;
                }
                const tex = new Texture2D();
                tex.image = imageAsset;
                const frame = new SpriteFrame();
                frame.texture = tex;
                bgSprite.spriteFrame = frame;
                console.log('[GameManager] Background loaded dynamically');
            }
        );
    }

    /**
     * 运行时创建 UI 节点并挂载组件
     * Canvas 1080×1920，原点在中心
     */
    private setupUI(): void {
        const canvas = this.node; // Canvas 节点

        // 1. AccountPanel —— 屏幕顶部
        if (!this.accountPanel) {
            const accountNode = new Node('AccountPanel');
            accountNode.addComponent('AccountPanel' as any);
            accountNode.setParent(canvas);
            accountNode.setPosition(new Vec3(0, 880, 0));
            this.accountPanel = accountNode;
            console.log('[GameManager] AccountPanel created at y=880');
        }

        // 2. OrderPanel —— 顶部下方
        if (!this.orderPanel) {
            const orderNode = new Node('OrderPanel');
            orderNode.addComponent('OrderPanel' as any);
            orderNode.setParent(canvas);
            orderNode.setPosition(new Vec3(0, 560, 0));
            this.orderPanel = orderNode;
            console.log('[GameManager] OrderPanel created at y=560');
        }

        // 3. EffectLayer —— 空容器，用于特效
        if (!this.effectLayer) {
            const effectNode = new Node('EffectLayer');
            effectNode.setParent(canvas);
            effectNode.setPosition(new Vec3(0, 0, 0));
            this.effectLayer = effectNode;
        }
    }

    /**
     * 生成测试物品（5 个发射器）
     */
    private spawnTestItems(): void {
        console.log('[GameManager] spawning test generators');

        // (1,4) 背包发射器
        const backpack = ItemManager.instance.spawnItem('backpack_generator', 1, 4);
        if (backpack) {
            console.log('[GameManager] spawned backpack_generator at col=1, row=4');
        }

        // (2,4) 蔬菜篮
        const vegetable = ItemManager.instance.spawnItem('vegetable_basket', 2, 4);
        if (vegetable) {
            console.log('[GameManager] spawned vegetable_basket at col=2, row=4');
        }

        // (3,4) 帐篷
        const tent = ItemManager.instance.spawnItem('tent', 3, 4);
        if (tent) {
            console.log('[GameManager] spawned tent at col=3, row=4');
        }

        // (4,4) 蓝莓发射器
        const blueberry = ItemManager.instance.spawnItem('blueberry_generator', 4, 4);
        if (blueberry) {
            console.log('[GameManager] spawned blueberry_generator at col=4, row=4');
        }

        // (5,4) 果酱发射器
        const jam = ItemManager.instance.spawnItem('jam_generator', 5, 4);
        if (jam) {
            console.log('[GameManager] spawned jam_generator at col=5, row=4');
        }
    }

    /**
     * 开始新游戏
     */
    public startGame(): void {
        // TODO: 加载默认配置，生成棋盘与订单
    }

    /**
     * 重置当前游戏
     */
    public resetGame(): void {
        // TODO: 清空棋盘与订单，重新开始
    }

    update(deltaTime: number) {
        // TODO: 每帧更新逻辑
    }

    /**
     * 注册资源变化事件，用于测试事件是否触发
     */
    private registerResourceEvents(): void {
        EventManager.instance.on(EventManager.GOLD_CHANGED, (gold: number) => {
            console.log('[Event] GOLD_CHANGED:', gold);
        });
        EventManager.instance.on(EventManager.ENERGY_CHANGED, (energy: number) => {
            console.log('[Event] ENERGY_CHANGED:', energy);
        });
        EventManager.instance.on(EventManager.DIAMOND_CHANGED, (diamond: number) => {
            console.log('[Event] DIAMOND_CHANGED:', diamond);
        });
    }

    /**
     * 暴露测试 API 到全局，方便在控制台手动调用
     */
    private exposeTestAPIs(): void {
        if (typeof window !== 'undefined') {
            (window as any).addTestResources = () => {
                ResourceManager.instance.addTestResources();
            };
        }
    }

    // 对外获取棋盘管理器
    public get boardManager(): BoardManager | null {
        return this._boardManager;
    }
}
