import { _decorator, Component, Node, Vec2, Vec3, EventTouch, director, Camera, Sprite, SpriteFrame, Texture2D, UITransform, resources, tween } from 'cc';
import { ItemManager } from './ItemManager';
import { ItemData } from './ItemData';
import { Cell } from './Cell';
import { getGameContext } from './core/GameContext';
import { BoardManager } from './BoardManager';

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

    onLoad() {
        this.registerTouchEvents();
        this.createVisual();
    }

    onDestroy() {
        this.unregisterTouchEvents();
    }

    /**
     * 创建物品视觉：UITransform 固定大小 + Sprite 组件
     * Sprite.sizeMode = CUSTOM，强制缩放到格子大小
     */
    private createVisual(): void {
        // UITransform：固定显示大小，锚点居中
        const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        transform.setContentSize(BoardManager.CELL_SIZE, BoardManager.CELL_SIZE);
        transform.setAnchorPoint(0.5, 0.5);

        // Sprite：CUSTOM 模式，不管原图分辨率都缩放到格子大小
        this._sprite = this.node.addComponent(Sprite);
        this._sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._sprite.type = Sprite.Type.SIMPLE;

        // 如果创建时已有数据，立即加载图片
        if (this._data) {
            this.loadIcon();
        }
    }

    /**
     * 刷新视觉：数据变化时重新加载对应图片
     */
    private refreshVisual(): void {
        this.loadIcon();
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
        }

        const touchWorldPos = this.screenToWorld(event.getLocation());
        const targetWorldPos = Vec3.add(new Vec3(), touchWorldPos, this._dragOffset);
        this.node.worldPosition = targetWorldPos;
    }

    private onTouchEnd(event: EventTouch): void {
        if (this._isDragging) {
            this.finalizeDrag();
        } else {
            // 未进入拖动状态，视为点击
            this.restoreZ();
            this.node.setSiblingIndex(this._originalSiblingIndex);
            this.handleClick();
        }

        this._startScreenPos = null;
        this._isDragging = false;
    }

    private onTouchCancel(event: EventTouch): void {
        const wasDragging = this._isDragging;

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
        if (!itemData || !itemData.isGenerator) {
            return;
        }

        this.playClickAnimation();
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
