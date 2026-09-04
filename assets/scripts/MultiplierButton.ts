import { _decorator, Component, Node, Vec3, Graphics, Color, Label, UITransform, EventTouch } from 'cc';
import { EventManager } from './core/EventManager';
// 注意：不直接 import GameManager，避免循环依赖
// MultiplierButton 通过事件通知 GameManager 切换倍数

const { ccclass, property } = _decorator;

/**
 * 倍数按钮
 * 点击循环切换 x1 → x2 → x4 → x8 → x1
 * 不同倍数显示不同颜色
 */
@ccclass('MultiplierButton')
export class MultiplierButton extends Component {
    /** 按钮宽度 */
    private static readonly BTN_WIDTH = 120;
    /** 按钮高度 */
    private static readonly BTN_HEIGHT = 80;
    /** 圆角半径 */
    private static readonly CORNER_RADIUS = 12;

    /** 倍数档位对应的颜色 */
    private static readonly MULTIPLIER_COLORS: Record<number, Color> = {
        1: new Color(255, 255, 255, 255),
        2: new Color(80, 220, 100, 255),
        4: new Color(80, 140, 255, 255),
        8: new Color(190, 90, 255, 255),
        16: new Color(255, 140, 0, 255),
    };

    private _graphics: Graphics | null = null;
    private _label: Label | null = null;
    private _currentMultiplier: number = 1;
    private _boundOnClick: ((event: EventTouch) => void) | null = null;
    private _boundOnMultiplierChanged: ((multiplier: number) => void) | null = null;

    onLoad() {
        this.createVisual();
        this.registerEvents();
        this.refreshDisplay();
    }

    onDestroy() {
        this.unregisterEvents();
    }

    /**
     * 创建按钮视觉：背景圆角矩形 + 文字标签
     */
    private createVisual(): void {
        const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        transform.setContentSize(MultiplierButton.BTN_WIDTH, MultiplierButton.BTN_HEIGHT);
        transform.setAnchorPoint(0.5, 0.5);

        this._graphics = this.node.addComponent(Graphics);
        this.drawBackground();

        const labelNode = new Node('Label');
        labelNode.setParent(this.node);
        labelNode.setPosition(new Vec3(0, 0, 0));
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(MultiplierButton.BTN_WIDTH - 20, MultiplierButton.BTN_HEIGHT - 10);
        this._label = labelNode.addComponent(Label);
        this._label.fontSize = 36;
        this._label.lineHeight = 40;
        this._label.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._label.verticalAlign = Label.VerticalAlign.CENTER;
    }

    /**
     * 绘制按钮背景（深灰半透明圆角矩形）
     */
    private drawBackground(): void {
        if (!this._graphics) return;
        this._graphics.clear();

        const w = MultiplierButton.BTN_WIDTH;
        const h = MultiplierButton.BTN_HEIGHT;
        const r = MultiplierButton.CORNER_RADIUS;

        this._graphics.fillColor = new Color(40, 40, 40, 220);
        this._graphics.roundRect(-w / 2, -h / 2, w, h, r);
        this._graphics.fill();

        const borderColor = MultiplierButton.MULTIPLIER_COLORS[this._currentMultiplier] || Color.WHITE;
        this._graphics.strokeColor = borderColor;
        this._graphics.lineWidth = 3;
        this._graphics.roundRect(-w / 2, -h / 2, w, h, r);
        this._graphics.stroke();
    }

    /**
     * 注册触摸事件和倍数变化事件
     */
    private registerEvents(): void {
        this._boundOnClick = (event: EventTouch) => this.onClick(event);
        this._boundOnMultiplierChanged = (multiplier: number) => this.onMultiplierChanged(multiplier);
        this.node.on(Node.EventType.TOUCH_END, this._boundOnClick);
        EventManager.instance.on(EventManager.MULTIPLIER_CHANGED, this._boundOnMultiplierChanged);
    }

    private unregisterEvents(): void {
        if (this._boundOnClick) {
            this.node.off(Node.EventType.TOUCH_END, this._boundOnClick);
        }
        if (this._boundOnMultiplierChanged) {
            EventManager.instance.off(EventManager.MULTIPLIER_CHANGED, this._boundOnMultiplierChanged);
        }
    }

    /**
     * 点击切换倍数
     */
    private onClick(event: EventTouch): void {
        // 通过事件通知 GameManager 切换倍数，避免循环依赖
        EventManager.instance.emit(EventManager.MULTIPLIER_TOGGLE);
    }

    /**
     * 倍数变化回调
     */
    private onMultiplierChanged(multiplier: number): void {
        this._currentMultiplier = multiplier;
        this.refreshDisplay();
    }

    /**
     * 刷新显示（文字颜色 + 边框颜色）
     */
    private refreshDisplay(): void {
        if (this._label) {
            this._label.string = `x${this._currentMultiplier}`;
            this._label.color = MultiplierButton.MULTIPLIER_COLORS[this._currentMultiplier] || Color.WHITE;
        }
        this.drawBackground();
    }

    /**
     * 设置当前倍数（由外部初始化时调用）
     */
    public setMultiplier(multiplier: number): void {
        this._currentMultiplier = multiplier;
        this.refreshDisplay();
    }
}
