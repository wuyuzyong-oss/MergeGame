import { _decorator, Component, Node, Vec2, Vec3, EventTouch, director, Camera, Graphics, Color, tween } from 'cc';
import { ItemManager } from './ItemManager';
import { ItemData } from './ItemData';
import { Cell } from './Cell';
import { getGameContext } from './core/GameContext';

const { ccclass, property } = _decorator;

/**
 * 物品组件
 * 仅负责物品节点的表现、拖拽交互以及与 ItemManager 通信
 * 不处理合成规则等业务逻辑
 */
@ccclass('Item')
export class Item extends Component {
    @property({ type: Number })
    public dragZOffset: number = 10;

    @property({ type: Number })
    public dragThreshold: number = 10;

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

    onLoad() {
        this.registerTouchEvents();
        this.createVisual();
    }

    onDestroy() {
        this.unregisterTouchEvents();
    }

    private createVisual(): void {
        const graphics = this.node.addComponent(Graphics);
        if (!graphics) {
            return;
        }

        const size = 70;
        const color = this.generateVisualColor();

        graphics.fillColor = color;
        graphics.rect(-size / 2, -size / 2, size, size);
        graphics.fill();

        graphics.strokeColor = Color.BLACK;
        graphics.lineWidth = 2;
        graphics.rect(-size / 2, -size / 2, size, size);
        graphics.stroke();
    }

    private refreshVisual(): void {
        const graphics = this.node.getComponent(Graphics);
        if (!graphics) {
            return;
        }
        graphics.clear();

        const size = 70;
        const color = this.generateVisualColor();

        graphics.fillColor = color;
        graphics.rect(-size / 2, -size / 2, size, size);
        graphics.fill();

        graphics.strokeColor = Color.BLACK;
        graphics.lineWidth = 2;
        graphics.rect(-size / 2, -size / 2, size, size);
        graphics.stroke();
    }

    private generateVisualColor(): Color {
        if (this._data) {
            const hash = this.hashString(this._data.itemId);
            const r = 100 + (hash % 155);
            const g = 100 + ((hash * 7) % 155);
            const b = 100 + ((hash * 13) % 155);
            return new Color(r, g, b, 255);
        }
        return new Color(200, 200, 200, 255);
    }

    private hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
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
