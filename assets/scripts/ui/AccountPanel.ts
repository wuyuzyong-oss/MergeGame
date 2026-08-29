import { _decorator, Component, Node, UITransform, Layout, Color, Graphics } from 'cc';
import { EventManager } from '../core/EventManager';
import { PlayerData } from '../PlayerData';
import { ResourceUI } from './ResourceUI';

const { ccclass, property } = _decorator;

/**
 * 顶部资源面板
 * 显示玩家等级、体力、金币、钻石
 * 通过 EventManager 监听资源变化，自动刷新显示
 *
 * 数据流：ResourceManager → EventManager → AccountPanel 监听 → 刷新 Label
 */
@ccclass('AccountPanel')
export class AccountPanel extends Component {
    private _resources: ResourceUI[] = [];

    onLoad() {
        this.buildUI();
        this.bindEvents();
        this.refreshAll();
    }

    // 生命周期与游戏一致，无需清理事件监听

    // ==================== UI 构建 ====================

    private buildUI(): void {
        // 面板容器尺寸
        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(1080, 100);
        transform.setAnchorPoint(0.5, 0.5);

        // 深色半透明背景
        const bg = this.node.addComponent(Graphics);
        bg.fillColor = new Color(25, 25, 35, 210);
        bg.rect(-540, -50, 1080, 100);
        bg.fill();

        // 水平布局
        const layout = this.node.addComponent(Layout);
        layout.type = Layout.Type.HORIZONTAL;
        layout.spacingX = 50;
        layout.resizeMode = Layout.ResizeMode.CONTAINER;
        layout.paddingLeft = 30;
        layout.paddingRight = 30;

        // 创建 4 项资源显示
        this._resources = [
            new ResourceUI('LevelLabel', () => `Lv${PlayerData.instance.level}`),
            new ResourceUI('EnergyLabel', () => `⚡${PlayerData.instance.energy} / ${PlayerData.instance.maxEnergy}`),
            new ResourceUI('GoldLabel', () => `💰${PlayerData.instance.gold}`),
            new ResourceUI('DiamondLabel', () => `💎${PlayerData.instance.diamond}`),
        ];

        for (const res of this._resources) {
            res.node.setParent(this.node);
        }
    }

    // ==================== 事件绑定 ====================

    private onGoldChanged = (): void => this.refreshByIndex(2);
    private onEnergyChanged = (): void => this.refreshByIndex(1);
    private onDiamondChanged = (): void => this.refreshByIndex(3);

    private bindEvents(): void {
        EventManager.instance.on(EventManager.GOLD_CHANGED, this.onGoldChanged);
        EventManager.instance.on(EventManager.ENERGY_CHANGED, this.onEnergyChanged);
        EventManager.instance.on(EventManager.DIAMOND_CHANGED, this.onDiamondChanged);

        // 等级变化（暂未有事件，定时刷新）
        this.schedule(() => this.refreshByIndex(0), 0.5);
    }

    onDestroy(): void {
        EventManager.instance.offAll(this.onGoldChanged);
        EventManager.instance.offAll(this.onEnergyChanged);
        EventManager.instance.offAll(this.onDiamondChanged);
    }

    // ==================== 刷新 ====================

    private refreshAll(): void {
        for (const res of this._resources) {
            res.refresh();
        }
    }

    private refreshByIndex(index: number): void {
        if (index >= 0 && index < this._resources.length) {
            this._resources[index].refresh();
        }
    }
}
