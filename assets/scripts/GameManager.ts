import { _decorator, Component, Node, Prefab, Vec3, Sprite, SpriteFrame, ImageAsset, UITransform, Texture2D, Canvas } from 'cc';
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
    private _bgSprite: Sprite | null = null;

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

        // 查找 GameContent 统一容器（在编辑器中创建，背景 + Debug棋盘 + 物品棋盘，统一缩放）
        const gameContent = this.getGameContent();
        if (!gameContent) {
            console.error('[GameManager] GameContent 节点未找到！请在编辑器 Canvas 下创建名为 GameContent 的空节点，并把 BoardPanel 拖进去');
            return;
        }

        // 创建背景图（GameContent 第一个子节点，最底层）
        this.createBackground(gameContent);
        this.loadBackground();

        // 创建 DebugBoard 节点（GameContent 子节点，位于 Background 之上、BoardPanel 之下）
        const debugBoard = this.createDebugBoard(gameContent);

        // 将 BoardPanel 节点传给 BoardManager，棋盘全部渲染到此节点下
        // debugBoard 作为 Debug 棋盘的视觉节点，与 BoardPanel 分离
        this._boardManager = new BoardManager();
        this._boardManager.initialize(this.boardPanel, debugBoard);

        // 初始化物品管理器（传入 BoardManager，避免循环依赖）
        ItemManager.instance.init(this.itemPrefab, this.boardPanel, this._boardManager);

        // 生成测试物品
        this.spawnTestItems();

        // 调试：打印棋盘子节点信息
        this.logBoardInfo();

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
     * 查找编辑器中创建的 GameContent 节点
     * 需要在 Cocos Creator Hierarchy 中手动创建：
     *
     * Canvas
     * ├── GameContent (1080×1920, anchor 0.5,0.5, position 0,0)
     * │   ├── Background        ← 稍后由代码创建
     * │   ├── DebugBoard        ← 稍后由代码创建
     * │   └── BoardPanel        ← 编辑器中拖入
     * ├── AccountPanel
     * ├── OrderPanel
     * └── EffectLayer
     */
    private getGameContent(): Node | null {
        const canvas = this.getCanvasNode();
        const gameContent = canvas.getChildByName('GameContent');
        if (gameContent) {
            console.log('[GameManager] GameContent found, children: ' + gameContent.children.length);
        }
        return gameContent;
    }


    /**
     * 获取真正的 Canvas 节点
     * GameManager 组件挂在 Canvas 的孙节点上（外面还有一层同名包裹节点），
     * this.node 并不是 Canvas，直接 setParent(this.node) 会让 Background
     * 在渲染遍历顺序中位于 BoardPanel 之后，从而把发射器盖住
     */
    private getCanvasNode(): Node {
        let node: Node | null = this.node;
        while (node) {
            const canvas = node.getComponent(Canvas);
            if (canvas) {
                return node;
            }
            node = node.parent;
        }
        return this.node;
    }

    /**
     * 创建游戏背景 Sprite 节点（1080×1920 全屏）
     * 作为 GameContent 的第一个子节点，渲染在最底层
     *
     * GameContent (1080×1920, 等比缩放)
     * ├── Background        ← 背景 PNG，siblingIndex=0
     * ├── DebugBoard        ← 半透明 Graphics 辅助网格
     * └── BoardPanel        ← 发射器 / 物品节点
     */
    private createBackground(gameContent: Node): void {
        const bgNode = new Node('Background');
        const transform = bgNode.addComponent(UITransform);
        transform.setContentSize(1080, 1920);
        transform.setAnchorPoint(0.5, 0.5);

        this._bgSprite = bgNode.addComponent(Sprite);
        this._bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._bgSprite.type = Sprite.Type.SIMPLE;

        bgNode.setParent(gameContent); // GameContent 子节点
        bgNode.setPosition(new Vec3(0, 0, 0));
        bgNode.setSiblingIndex(0); // 最底层
    }

    /**
     * 创建 DebugBoard 节点（GameContent 子节点）
     * 位于 Background 之上、BoardPanel 之下
     * BoardManager 的 Graphics 辅助网格会画到这个节点上
     */
    private createDebugBoard(gameContent: Node): Node {
        const debugNode = new Node('DebugBoard');
        const transform = debugNode.addComponent(UITransform);
        // DebugBoard 尺寸与棋盘一致，位置与 BoardPanel 相同
        transform.setContentSize(1050, 1350);
        transform.setAnchorPoint(0.5, 0.5);

        debugNode.setParent(gameContent); // GameContent 子节点
        // 与 BoardPanel 同位置，确保 Debug 网格跟随棋盘移动
        if (this.boardPanel) {
            debugNode.setPosition(this.boardPanel.position);
            debugNode.setSiblingIndex(this.boardPanel.getSiblingIndex());
        }
        return debugNode;
    }

    /**
     * 加载背景纹理并应用到背景 Sprite
     * 在编辑器中将 game_background.png 拖到 GameManager 的 Bg Texture 属性
     */
    private loadBackground(): void {
        if (!this._bgSprite) return;

        if (this.bgTexture) {
            const tex = new Texture2D();
            tex.image = this.bgTexture;
            const frame = new SpriteFrame();
            frame.texture = tex;
            this._bgSprite.spriteFrame = frame;
            console.log('[GameManager] Background texture applied');
        } else {
            console.warn('[GameManager] bgTexture not set. Drag game_background.png to GameManager.BgTexture in editor');
        }
    }

    /**
     * 运行时创建 UI 节点并挂载组件
     * Canvas 1080×1920，原点在中心
     */
    private setupUI(): void {
        const canvas = this.getCanvasNode(); // 真正的 Canvas 节点

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
        const backpack = ItemManager.instance.spawnItem('bp_generator', 1, 4);
        if (backpack) {
            console.log('[GameManager] spawned bp_generator at col=1, row=4');
        }

        // (2,4) 蔬菜篮
        const vegetable = ItemManager.instance.spawnItem('veg_generator', 2, 4);
        if (vegetable) {
            console.log('[GameManager] spawned veg_generator at col=2, row=4');
        }

        // (3,4) 帐篷
        const tent = ItemManager.instance.spawnItem('tent_generator', 3, 4);
        if (tent) {
            console.log('[GameManager] spawned tent at col=3, row=4');
        }

        // (4,4) 蓝莓发射器
        const blueberry = ItemManager.instance.spawnItem('berry_generator', 4, 4);
        if (blueberry) {
            console.log('[GameManager] spawned berry_generator at col=4, row=4');
        }

        // (5,4) 果酱发射器
        const jam = ItemManager.instance.spawnItem('jam_generator', 5, 4);
        if (jam) {
            console.log('[GameManager] spawned jam_generator at col=5, row=4');
        }
    }

    /**
     * 调试：打印棋盘面板的子节点和位置信息
     */
    private logBoardInfo(): void {
        if (!this.boardPanel) return;
        console.log(`[GameManager] BoardPanel localPos: ${JSON.stringify(this.boardPanel.position)}`);
        console.log(`[GameManager] BoardPanel worldPos: ${JSON.stringify(this.boardPanel.worldPosition)}`);
        console.log(`[GameManager] BoardPanel children: ${this.boardPanel.children.length}`);
        for (let i = 0; i < this.boardPanel.children.length; i++) {
            const child = this.boardPanel.children[i];
            console.log(`  [${i}] ${child.name} pos=${JSON.stringify(child.position)}`);
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
