import { _decorator, Component } from 'cc';
import { ResourceManager } from '../resource/ResourceManager';
import { PlayerData } from '../PlayerData';
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

    onLoad(): void {
        this.createPanel();
        this.bindKeyboard();
        console.log('[GMManager] GM面板已创建，按 F1 显示/隐藏');
    }

    onDestroy(): void {
        this.removePanel();
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
            width: 260px;
            min-height: 80px;
            background: rgba(0, 0, 0, 0.8);
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

        panel.appendChild(content);

        // 添加到页面body
        document.body.appendChild(panel);
        this._panelElement = panel;
    }

    /**
     * 创建单个资源的修改区域
     * @param label 资源名称
     * @param key 资源key（energy/gold/diamond）
     * @param currentValue 当前值
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
     * @param key 资源key（energy/gold/diamond）
     */
    private setResource(key: string): void {
        const input = document.getElementById(`gm-${key}-input`) as HTMLInputElement;
        const valueLabel = document.getElementById(`gm-${key}-value`);
        if (!input || !valueLabel) return;

        const value = parseFloat(input.value);
        if (isNaN(value) || value < 0) {
            alert('请输入有效的非负数字');
            return;
        }

        // 调用ResourceManager设置，实时生效
        if (key === 'gold') {
            ResourceManager.instance.setGold(value);
        } else if (key === 'energy') {
            ResourceManager.instance.setEnergy(value);
        } else if (key === 'diamond') {
            ResourceManager.instance.setDiamond(value);
        }

        // 更新面板上的当前值显示
        const newValue = key === 'energy' ? PlayerData.instance.energy :
                         key === 'gold' ? PlayerData.instance.gold :
                         PlayerData.instance.diamond;
        valueLabel.textContent = `当前: ${newValue}`;

        // 清空输入框
        input.value = '';
    }

    /**
     * 移除GM面板
     */
    private removePanel(): void {
        if (this._panelElement && this._panelElement.parentNode) {
            this._panelElement.parentNode.removeChild(this._panelElement);
            this._panelElement = null;
        }
    }

    /**
     * 显示面板
     */
    public showPanel(): void {
        if (this._panelElement) {
            this._panelElement.style.display = 'block';
            this._isVisible = true;
            // 显示时刷新当前值
            this.refreshAllValues();
        }
    }

    /**
     * 隐藏面板
     */
    public hidePanel(): void {
        if (this._panelElement) {
            this._panelElement.style.display = 'none';
            this._isVisible = false;
        }
    }

    /**
     * 切换面板显示/隐藏
     */
    public togglePanel(): void {
        if (this._isVisible) {
            this.hidePanel();
        } else {
            this.showPanel();
        }
    }

    /**
     * 刷新面板上所有资源的当前值显示
     */
    private refreshAllValues(): void {
        const energyLabel = document.getElementById('gm-energy-value');
        const goldLabel = document.getElementById('gm-gold-value');
        const diamondLabel = document.getElementById('gm-diamond-value');
        if (energyLabel) energyLabel.textContent = `当前: ${PlayerData.instance.energy}`;
        if (goldLabel) goldLabel.textContent = `当前: ${PlayerData.instance.gold}`;
        if (diamondLabel) diamondLabel.textContent = `当前: ${PlayerData.instance.diamond}`;
    }

    /**
     * 绑定键盘快捷键（F1显示/隐藏）
     */
    private bindKeyboard(): void {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'F1') {
                e.preventDefault();
                this.togglePanel();
            }
        });
    }
}
