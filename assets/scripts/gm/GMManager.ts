import { _decorator, Component } from 'cc';
import { ResourceManager } from '../resource/ResourceManager';
import { PlayerData } from '../PlayerData';
import { ItemManager } from '../ItemManager';
import { BoardManager } from '../BoardManager';
import { GameManager } from '../GameManager';
import { EventManager } from '../core/EventManager';
import { AudioManager } from '../AudioManager';
import { OrderManager, OrderStatus } from '../order/OrderManager';
import { OrderData } from '../order/OrderData';
import { GMOrderCompleter } from './GMOrderCompleter';
const { ccclass } = _decorator;

/**
 * GM调试面板（DOM方式，在游戏画布外面）
 *
 * 特点：
 * - 面板是独立的HTML DOM元素，不属于Cocos游戏内节点
 * - 不会被游戏拖拽系统影响，不能拖入游戏棋盘
 * - 不受游戏相机、窗口缩放影响
 * - 按 F1 键显示/隐藏面板
 *
 * 使用方法：
 * 1. 在Cocos编辑器中，把本脚本挂载到 Canvas 节点上
 * 2. 运行游戏，GM面板会出现在页面右上角
 * 3. 按 F1 键可以显示/隐藏面板
 *
 * 注意：
 * - 本面板仅在Web平台有效（浏览器/网页小游戏）
 * - 正式发布版本时，取消挂载本脚本即可隐藏GM面板
 */
@ccclass('GMManager')
export class GMManager extends Component {
    /** GM面板的DOM元素 */
    private _panelElement: HTMLElement | null = null;

    /** 面板是否显示 */
    private _isVisible: boolean = true;

    /** 订单列表容器（动态渲染每个订单行） */
    private _orderListContainer: HTMLElement | null = null;

    /** 当前正在自动完成的订单 ID，防止重复点击 */
    private _completingOrderId: string | null = null;

    /** 订单完成模式：true=自动（物品齐全自动完成），false=手动（物品齐全即停，人工点完成） */
    private _autoComplete: boolean = true;

    /** 订单变化事件回调引用（用于解绑） */
    private _boundOnOrderChanged: (() => void) | null = null;

    /** 日志输出容器 */
    private _logContainer: HTMLElement | null = null;

    /** 日志最大保留条数 */
    private static readonly MAX_LOG_ENTRIES = 60;

    onLoad(): void {
        this.createPanel();
        this.bindKeyboard();
        this.bindOrderEvents();
        console.log('[GMManager] GM面板已创建，按 F1 显示/隐藏');
    }

    onDestroy(): void {
        if (this._boundOnOrderChanged) {
            EventManager.instance.off(EventManager.ORDER_CHANGED, this._boundOnOrderChanged);
            this._boundOnOrderChanged = null;
        }
        this.removePanel();
    }

    /**
     * 绑定订单相关事件：订单变化时刷新列表 + 开局延迟刷新捕获初始订单
     */
    private bindOrderEvents(): void {
        this._boundOnOrderChanged = () => {
            // 延迟刷新，等订单数据与动画状态稳定
            setTimeout(() => this.refreshOrderList(), 100);
        };
        EventManager.instance.on(EventManager.ORDER_CHANGED, this._boundOnOrderChanged);
        // 初始延迟刷新，捕获开局生成的订单
        setTimeout(() => this.refreshOrderList(), 1000);
    }

    /**
     * 创建GM面板（DOM元素，在游戏画布外面）
     */
    private createPanel(): void {
        // 创建面板容器
        const panel = document.createElement('div');
        panel.id = 'gm-panel';
        panel.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 280px;
            max-height: 90vh;
            overflow-y: auto;
            min-height: 80px;
            background: rgba(0, 0, 0, 0.85);
            color: #ffffff;
            border-radius: 8px;
            padding: 10px;
            z-index: 99999;
            font-family: Arial, sans-serif;
            font-size: 13px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
            user-select: none;
        `;

        // 标题栏
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            position: sticky;
            top: 0;
            background: rgba(0, 0, 0, 0.9);
            z-index: 10;
        `;

        const title = document.createElement('span');
        title.textContent = 'GM 调试面板';
        title.style.fontWeight = 'bold';

        const hideBtn = document.createElement('button');
        hideBtn.textContent = '隐藏';
        hideBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.2);
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 3px 8px;
            cursor: pointer;
            font-size: 12px;
        `;
        hideBtn.onclick = () => this.hidePanel();

        header.appendChild(title);
        header.appendChild(hideBtn);
        panel.appendChild(header);

        // 功能区域
        const content = document.createElement('div');
        content.id = 'gm-panel-content';
        content.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;

        // ========== 资源修改区域 ==========
        content.appendChild(this.createResourceSection('体力', 'energy', PlayerData.instance.energy));
        content.appendChild(this.createResourceSection('金币', 'gold', PlayerData.instance.gold));
        content.appendChild(this.createResourceSection('钻石', 'diamond', PlayerData.instance.diamond));

        // ========== 清空物品区域 ==========
        content.appendChild(this.createClearSection());

        // ========== 订单操作区域 ==========
        content.appendChild(this.createOrderSection());

        // ========== 音频开关区域 ==========
        content.appendChild(this.createAudioSection());

        // ========== 日志输出区域 ==========
        content.appendChild(this.createLogSection());

        panel.appendChild(content);

        // 添加到页面body
        document.body.appendChild(panel);
        this._panelElement = panel;
    }

    /**
     * 创建单个资源的修改区域
     */
    private createResourceSection(label: string, key: string, currentValue: number): HTMLElement {
        const section = document.createElement('div');
        section.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 8px;
        `;

        // 标题行：名称 + 当前值
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        `;

        const nameLabel = document.createElement('span');
        nameLabel.textContent = label;
        nameLabel.style.fontWeight = 'bold';

        const valueLabel = document.createElement('span');
        valueLabel.id = `gm-${key}-value`;
        valueLabel.textContent = `当前: ${currentValue}`;
        valueLabel.style.color = '#ffd700';

        titleRow.appendChild(nameLabel);
        titleRow.appendChild(valueLabel);
        section.appendChild(titleRow);

        // 输入行：输入框 + 设置按钮
        const inputRow = document.createElement('div');
        inputRow.style.cssText = `
            display: flex;
            gap: 6px;
        `;

        const input = document.createElement('input');
        input.type = 'number';
        input.id = `gm-${key}-input`;
        input.placeholder = '输入数值';
        input.style.cssText = `
            flex: 1;
            padding: 4px 6px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.5);
            color: #fff;
            font-size: 12px;
            width: 100%;
            box-sizing: border-box;
        `;

        const setBtn = document.createElement('button');
        setBtn.textContent = '设置';
        setBtn.style.cssText = `
            background: #4CAF50;
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
        `;
        setBtn.onclick = () => this.setResource(key);

        inputRow.appendChild(input);
        inputRow.appendChild(setBtn);
        section.appendChild(inputRow);

        return section;
    }

    /**
     * 设置资源数值
     */
    private setResource(key: string): void {
        const input = document.getElementById(`gm-${key}-input`) as HTMLInputElement;
        if (!input) return;

        const value = parseInt(input.value, 10);
        if (isNaN(value) || value < 0) {
            this.appendLog('资源设置失败：请输入有效的非负整数', 'warn');
            return;
        }

        try {
            switch (key) {
                case 'energy':
                    ResourceManager.instance.setEnergy(value);
                    break;
                case 'gold':
                    ResourceManager.instance.setGold(value);
                    break;
                case 'diamond':
                    ResourceManager.instance.setDiamond(value);
                    break;
            }
            console.log(`[GMManager] 设置 ${key} = ${value}`);
            this.refreshAllValues();
        } catch (e) {
            this.appendLog(`资源设置失败: ${e}`, 'error');
        }
    }

    /**
     * 创建清空物品区域
     */
    private createClearSection(): HTMLElement {
        const section = document.createElement('div');
        section.style.cssText = `
            background: rgba(255, 100, 100, 0.15);
            border: 1px solid rgba(255, 100, 100, 0.4);
            border-radius: 6px;
            padding: 8px;
        `;

        // 标题行
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        `;

        const nameLabel = document.createElement('span');
        nameLabel.textContent = '棋盘操作';
        nameLabel.style.fontWeight = 'bold';
        nameLabel.style.color = '#ff8888';

        const countLabel = document.createElement('span');
        countLabel.id = 'gm-item-count';
        countLabel.textContent = '物品: 0';
        countLabel.style.color = '#ffd700';
        countLabel.style.fontSize = '12px';

        titleRow.appendChild(nameLabel);
        titleRow.appendChild(countLabel);
        section.appendChild(titleRow);

        // 清空按钮
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清空所有物品（保留发射器）';
        clearBtn.style.cssText = `
            width: 100%;
            background: #e74c3c;
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
        `;
        clearBtn.onclick = () => this.clearAllItems();

        section.appendChild(clearBtn);

        // 刷新物品数量
        this.refreshItemCount();

        return section;
    }

    /**
     * 清空棋盘上所有非发射器物品
     */
    private clearAllItems(): void {
        try {
            const itemManager = ItemManager.instance;
            const boardManager = GameManager.instance?.boardManager;
            if (!itemManager || !boardManager) {
                console.error('[GMManager] ItemManager 或 BoardManager 未初始化');
                return;
            }

            // 遍历棋盘所有格子，找到非发射器物品并删除
            let clearedCount = 0;
            const itemsToDestroy: any[] = [];

            for (let col = 0; col < BoardManager.COLS; col++) {
                for (let row = 0; row < BoardManager.ROWS; row++) {
                    const cell = boardManager.getCell(col, row);
                    if (!cell) continue;
                    const itemData = cell.getItem();
                    if (!itemData) continue;
                    // 跳过发射器
                    if (itemData.isGenerator) continue;
                    itemsToDestroy.push(itemData);
                }
            }

            // 找到对应的节点并销毁
            const boardRoot = itemManager['_boardRoot'] as any;
            if (boardRoot) {
                for (const child of boardRoot.children) {
                    const comp = child.getComponent('Item') as any;
                    if (comp && comp.data && !comp.data.isGenerator) {
                        itemManager.destroyItem(child);
                        clearedCount++;
                    }
                }
            }

            // 触发订单变化事件，更新订单状态
            EventManager.instance.emit(EventManager.ORDER_CHANGED);

            console.log(`[GMManager] 已清空 ${clearedCount} 个物品（发射器保留）`);

            // 刷新物品数量显示
            this.refreshItemCount();
        } catch (e) {
            console.error(`[GMManager] 清空失败: ${e}`);
        }
    }

    /**
     * 刷新面板上的物品数量显示
     */
    private refreshItemCount(): void {
        const countEl = document.getElementById('gm-item-count');
        if (!countEl) return;

        try {
            const boardManager = GameManager.instance?.boardManager;
            if (!boardManager) {
                countEl.textContent = '物品: -';
                return;
            }

            let itemCount = 0;
            let generatorCount = 0;
            for (let col = 0; col < BoardManager.COLS; col++) {
                for (let row = 0; row < BoardManager.ROWS; row++) {
                    const cell = boardManager.getCell(col, row);
                    if (!cell) continue;
                    const itemData = cell.getItem();
                    if (!itemData) continue;
                    if (itemData.isGenerator) {
                        generatorCount++;
                    } else {
                        itemCount++;
                    }
                }
            }
            countEl.textContent = `物品: ${itemCount} / 发射器: ${generatorCount}`;
        } catch (e) {
            countEl.textContent = '物品: -';
        }
    }

    /**
     * 创建订单操作区域（订单列表 + 每订单一键完成按钮）
     */
    private createOrderSection(): HTMLElement {
        const section = document.createElement('div');
        section.style.cssText = `
            background: rgba(150, 255, 150, 0.1);
            border: 1px solid rgba(150, 255, 150, 0.4);
            border-radius: 6px;
            padding: 8px;
        `;

        // 标题行：区域标题 + 完成模式切换按钮
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        `;

        const title = document.createElement('div');
        title.textContent = '订单操作';
        title.style.fontWeight = 'bold';
        title.style.color = '#99ff99';

        // 完成模式切换按钮（自动：物品齐全后自动完成；手动：物品齐全即停，人工点完成）
        const modeBtn = document.createElement('button');
        modeBtn.id = 'gm-order-mode';
        modeBtn.style.cssText = `
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 3px 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            white-space: nowrap;
        `;
        this.updateOrderModeButton(modeBtn);
        modeBtn.onclick = () => this.toggleOrderMode();

        titleRow.appendChild(title);
        titleRow.appendChild(modeBtn);
        section.appendChild(titleRow);

        // 订单列表容器
        const listContainer = document.createElement('div');
        listContainer.id = 'gm-order-list';
        listContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 6px;
        `;
        section.appendChild(listContainer);
        this._orderListContainer = listContainer;

        // 首次渲染（此时订单可能未初始化，显示占位）
        this.refreshOrderList();

        return section;
    }

    /**
     * 刷新订单列表：读取当前订单，逐个渲染订单行 + 一键完成按钮
     */
    private refreshOrderList(): void {
        const container = this._orderListContainer;
        if (!container) return;

        // 清空旧内容
        container.innerHTML = '';

        // 游戏上下文未就绪时显示占位：GMManager 挂在 Canvas 上，其 onLoad 先于子节点 GameManager，
        // 此时 BoardManager 尚未创建，跳过 checkOrders 避免触发 "BoardManager not found" 错误日志
        if (!GameManager.instance?.boardManager) {
            const loading = document.createElement('div');
            loading.textContent = '加载中...';
            loading.style.cssText = 'color:#aaa;font-size:12px;padding:4px;';
            container.appendChild(loading);
            return;
        }

        let orders: OrderData[] = [];
        const statusMap = new Map<string, OrderStatus>();
        try {
            orders = OrderManager.instance.getCurrentOrders();
            const results = OrderManager.instance.checkOrders();
            for (const r of results) {
                statusMap.set(r.order.id, r.status);
            }
        } catch (e) {
            console.warn('[GMManager] refreshOrderList 读取订单失败', e);
        }

        if (orders.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '暂无订单';
            empty.style.cssText = 'color:#aaa;font-size:12px;padding:4px;';
            container.appendChild(empty);
            return;
        }

        orders.forEach((order, index) => {
            container.appendChild(this.createOrderRow(order, index, statusMap.get(order.id)));
        });
    }

    /**
     * 创建单个订单行（订单信息 + 状态标记 + 一键完成按钮）
     */
    private createOrderRow(order: OrderData, index: number, status?: OrderStatus): HTMLElement {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 6px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            padding: 6px;
        `;

        // 左侧：订单信息
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';

        // 状态标记
        let statusText = ' [未就绪]';
        let statusColor = '#aaaaaa';
        if (status === OrderStatus.COMPLETE) {
            statusText = ' [可完成]';
            statusColor = '#4CAF50';
        } else if (status === OrderStatus.PARTIAL) {
            statusText = ' [部分]';
            statusColor = '#ffaa00';
        }

        const titleLine = document.createElement('div');
        titleLine.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:2px;';
        titleLine.innerHTML = `订单${index + 1}<span style="color:${statusColor};font-weight:normal;">${statusText}</span>`;

        const itemsLine = document.createElement('div');
        itemsLine.style.cssText = 'font-size:11px;color:#cccccc;word-break:break-all;';
        // 需求数量恒为1时不显示冗余的 x1，仅当数量>1才显示 xN
        itemsLine.textContent = order.items.map(it => it.count > 1 ? `${it.itemId} x${it.count}` : it.itemId).join(', ');

        info.appendChild(titleLine);
        info.appendChild(itemsLine);

        // 右侧：一键完成按钮
        const btn = document.createElement('button');
        const isCompleting = this._completingOrderId === order.id;
        const anyCompleting = this._completingOrderId !== null;
        btn.textContent = isCompleting ? '完成中...' : '一键完成';
        btn.disabled = anyCompleting;
        btn.style.cssText = `
            background: ${anyCompleting ? '#666666' : '#4CAF50'};
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 6px 10px;
            cursor: ${anyCompleting ? 'not-allowed' : 'pointer'};
            font-size: 12px;
            font-weight: bold;
            white-space: nowrap;
        `;
        btn.onclick = () => this.onCompleteOrderClick(order.id, index + 1);

        row.appendChild(info);
        row.appendChild(btn);
        return row;
    }

    /**
     * 点击「一键完成」按钮：加锁 → 调用编排器 → 完成后解锁并刷新
     */
    private onCompleteOrderClick(orderId: string, orderNo: number): void {
        if (this._completingOrderId) {
            return; // 已有订单在完成中，忽略
        }
        this._completingOrderId = orderId;
        // 立即刷新，显示「完成中...」并禁用所有按钮
        this.refreshOrderList();

        this.appendLog(`开始一键完成 订单${orderNo}（${this._autoComplete ? '自动' : '手动'}模式）`, 'info');

        GMOrderCompleter.completeOrder(orderId, this._autoComplete, (success, message) => {
            this._completingOrderId = null;
            this.refreshOrderList();
            if (success) {
                this.appendLog(`订单${orderNo}：${message || '已完成'}`, 'info');
            } else {
                this.appendLog(`订单${orderNo} 完成失败：${message}`, 'error');
            }
        });
    }

    /**
     * 切换订单完成模式（自动 ↔ 手动）
     */
    private toggleOrderMode(): void {
        this._autoComplete = !this._autoComplete;
        const btn = document.getElementById('gm-order-mode') as HTMLButtonElement;
        if (btn) {
            this.updateOrderModeButton(btn);
        }
        console.log(`[GMManager] 订单完成模式 -> ${this._autoComplete ? '自动' : '手动'}`);
    }

    /**
     * 更新完成模式按钮的文字与颜色
     */
    private updateOrderModeButton(btn: HTMLButtonElement): void {
        btn.textContent = this._autoComplete ? '完成: 自动' : '完成: 手动';
        btn.style.background = this._autoComplete ? '#4CAF50' : '#ff9800';
    }

    /**
     * 创建音频开关区域
     */
    private createAudioSection(): HTMLElement {
        const section = document.createElement('div');
        section.style.cssText = `
            background: rgba(100, 200, 255, 0.1);
            border: 1px solid rgba(100, 200, 255, 0.4);
            border-radius: 6px;
            padding: 8px;
        `;

        // 标题
        const title = document.createElement('div');
        title.textContent = '音频控制';
        title.style.fontWeight = 'bold';
        title.style.color = '#88ddff';
        title.style.marginBottom = '8px';
        section.appendChild(title);

        // 按钮容器
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

        // 背景音乐开关按钮
        const bgmBtn = document.createElement('button');
        bgmBtn.id = 'gm-bgm-toggle';
        bgmBtn.textContent = AudioManager.instance.isBGMEnabled() ? '🎵 BGM: 开' : '🎵 BGM: 关';
        bgmBtn.style.cssText = `
            flex: 1;
            background: ${AudioManager.instance.isBGMEnabled() ? '#4CAF50' : '#666'};
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 6px 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
        `;
        bgmBtn.onclick = () => this.toggleBGM();

        // 音效开关按钮
        const sfxBtn = document.createElement('button');
        sfxBtn.id = 'gm-sfx-toggle';
        sfxBtn.textContent = AudioManager.instance.isSFXEnabled() ? '🔊 音效: 开' : '🔇 音效: 关';
        sfxBtn.style.cssText = `
            flex: 1;
            background: ${AudioManager.instance.isSFXEnabled() ? '#4CAF50' : '#666'};
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 6px 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
        `;
        sfxBtn.onclick = () => this.toggleSFX();

        btnContainer.appendChild(bgmBtn);
        btnContainer.appendChild(sfxBtn);
        section.appendChild(btnContainer);

        return section;
    }

    /**
     * 切换背景音乐开关
     */
    private toggleBGM(): void {
        const enabled = AudioManager.instance.toggleBGM();
        const btn = document.getElementById('gm-bgm-toggle') as HTMLButtonElement;
        if (btn) {
            btn.textContent = enabled ? '🎵 BGM: 开' : '🎵 BGM: 关';
            btn.style.background = enabled ? '#4CAF50' : '#666';
        }
    }

    /**
     * 切换音效开关
     */
    private toggleSFX(): void {
        const enabled = AudioManager.instance.toggleSFX();
        const btn = document.getElementById('gm-sfx-toggle') as HTMLButtonElement;
        if (btn) {
            btn.textContent = enabled ? '🔊 音效: 开' : '🔇 音效: 关';
            btn.style.background = enabled ? '#4CAF50' : '#666';
        }
    }

    /**
     * 创建日志输出区域（一键完成等操作的问题在此显示，替代弹窗）
     */
    private createLogSection(): HTMLElement {
        const section = document.createElement('div');
        section.style.cssText = `
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 6px;
            padding: 8px;
        `;

        // 标题行：标题 + 清空按钮
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        `;

        const title = document.createElement('div');
        title.textContent = '日志';
        title.style.fontWeight = 'bold';
        title.style.color = '#dddddd';

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清空';
        clearBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.2);
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 11px;
        `;
        clearBtn.onclick = () => this.clearLog();

        titleRow.appendChild(title);
        titleRow.appendChild(clearBtn);
        section.appendChild(titleRow);

        // 日志容器（可滚动，等宽字体）
        const logContainer = document.createElement('div');
        logContainer.id = 'gm-log-container';
        logContainer.style.cssText = `
            height: 150px;
            overflow-y: auto;
            background: rgba(0, 0, 0, 0.5);
            border-radius: 4px;
            padding: 4px 6px;
            font-family: Consolas, Monaco, monospace;
        `;
        section.appendChild(logContainer);
        this._logContainer = logContainer;

        return section;
    }

    /**
     * 追加一条日志到日志区域
     * @param message 日志内容
     * @param level   级别：info（普通）/ warn（警告）/ error（错误），决定颜色
     */
    private appendLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        const container = this._logContainer;
        if (!container) return;

        const color = level === 'error' ? '#ff6b6b' : (level === 'warn' ? '#ffcc66' : '#cccccc');
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        const line = document.createElement('div');
        line.style.cssText = `
            color: ${color};
            font-size: 11px;
            line-height: 1.4;
            word-break: break-all;
            padding: 1px 0;
        `;
        line.textContent = `[${time}] ${message}`;
        container.appendChild(line);

        // 超过上限移除最旧的
        while (container.children.length > GMManager.MAX_LOG_ENTRIES) {
            const first = container.firstChild;
            if (!first) break;
            container.removeChild(first);
        }

        // 自动滚动到底部
        container.scrollTop = container.scrollHeight;
    }

    /**
     * 清空日志区域
     */
    private clearLog(): void {
        if (this._logContainer) {
            this._logContainer.innerHTML = '';
        }
    }

    /**
     * 刷新面板上所有资源的当前值显示
     */
    private refreshAllValues(): void {
        const energyEl = document.getElementById('gm-energy-value');
        if (energyEl) energyEl.textContent = `当前: ${PlayerData.instance.energy}`;

        const goldEl = document.getElementById('gm-gold-value');
        if (goldEl) goldEl.textContent = `当前: ${PlayerData.instance.gold}`;

        const diamondEl = document.getElementById('gm-diamond-value');
        if (diamondEl) diamondEl.textContent = `当前: ${PlayerData.instance.diamond}`;
    }

    /**
     * 绑定键盘快捷键
     */
    private bindKeyboard(): void {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F1') {
                e.preventDefault();
                this.togglePanel();
            }
        });
    }

    /**
     * 切换面板显示/隐藏
     */
    private togglePanel(): void {
        if (this._isVisible) {
            this.hidePanel();
        } else {
            this.showPanel();
        }
    }

    /**
     * 显示面板
     */
    private showPanel(): void {
        if (this._panelElement) {
            this._panelElement.style.display = 'block';
            this._isVisible = true;
            this.refreshAllValues();
            this.refreshItemCount();
            this.refreshOrderList();
        }
    }

    /**
     * 隐藏面板
     */
    private hidePanel(): void {
        if (this._panelElement) {
            this._panelElement.style.display = 'none';
            this._isVisible = false;
        }
    }

    /**
     * 移除面板
     */
    private removePanel(): void {
        if (this._panelElement && this._panelElement.parentNode) {
            this._panelElement.parentNode.removeChild(this._panelElement);
            this._panelElement = null;
        }
    }
}
