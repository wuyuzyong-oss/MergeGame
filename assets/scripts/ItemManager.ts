import { Vec3, Node, Prefab, instantiate, tween, Sprite, SpriteFrame, Texture2D, resources, UITransform } from 'cc';
import { BoardManager } from './BoardManager';
import { Cell } from './Cell';
import { ItemData } from './ItemData';
import { ConfigManager } from './ConfigManager';
import { MergeManager } from './MergeManager';
import { GeneratorManager } from './GeneratorManager';
import { EventManager } from './core/EventManager';
import { AudioManager } from './AudioManager';
// 注意：不 import GameManager，避免循环依赖
// BoardManager 通过 init() 传入

/**
 * 物品管理器
 * 负责物品的生成、销毁、拖拽落点处理、合成处理
 */
export class ItemManager {
    private static _instance: ItemManager = new ItemManager();
    public static get instance(): ItemManager {
        return ItemManager._instance;
    }

    private _itemPrefab: Prefab | null = null;
    private _boardRoot: Node | null = null;
    private _boardManager: BoardManager | null = null;

    /** 当前选中的物品节点（选中状态下发射器才能发射） */
    private _selectedItem: Node | null = null;

    // ==================== 合成爆炸特效 ====================
    /** 合成爆炸序列帧路径 */
    private static readonly MERGE_EXPLOSION_PATH = 'textures/effect/merge_explosion';
    /** 合成爆炸特效帧率（FPS） */
    private static readonly MERGE_EXPLOSION_FPS = 20;
    /** 合成爆炸特效显示大小（像素） */
    private static readonly MERGE_EXPLOSION_SIZE = 350;

    /** 合成爆炸序列帧缓存（静态，所有 ItemManager 共享） */
    private static _mergeExplosionFrames: SpriteFrame[] | null = null;

    /**
     * 初始化管理器
     * @param itemPrefab   物品预制体资源
     * @param boardRoot    棋盘父节点，物品实例化后挂到该节点下
     * @param boardManager 棋盘管理器，用于格子查询与坐标转换
     */
    public init(itemPrefab: Prefab, boardRoot: Node, boardManager: BoardManager): void {
        this._itemPrefab = itemPrefab;
        this._boardRoot = boardRoot;
        this._boardManager = boardManager;
    }

    /**
     * 在指定棋盘格子生成一个物品
     * 会根据配置表初始化 chainId / level / maxLevel
     * @param itemId 物品配置 ID
     * @param col    棋盘列
     * @param row    棋盘行
     * @returns      生成的物品节点
     */
    public spawnItem(itemId: string, col: number, row: number): Node | null {
        const config = ConfigManager.instance.getItemConfig(itemId);
        if (!config) {
            console.error(`[ItemManager] config not found for itemId: ${itemId}`);
            return null;
        }

        const itemData = new ItemData({
            itemId: config.itemId,
            chainId: config.chainId,
            level: config.level,
            maxLevel: config.maxLevel,
            isGenerator: config.isGenerator ?? false,
        });

        // 如果是发射器，从 generators.json 读取寿命
        if (config.isGenerator) {
            const genConfig = ConfigManager.instance.getGeneratorConfig(itemId);
            if (genConfig && typeof genConfig.life === 'number') {
                itemData.generatorLife = genConfig.life;
            }
        }

        return this.spawnItemWithData(itemData, col, row);
    }

    // ==================== 选中状态管理 ====================

    /**
     * 选中物品（取消之前的选中）
     */
    public selectItem(itemNode: Node): void {
        if (this._selectedItem === itemNode) return;
        this.deselectItem();
        this._selectedItem = itemNode;
        const comp = this.getItemComponent(itemNode);
        comp?.setSelected(true);
        console.log(`[ItemManager] selected: ${comp?.data?.itemId ?? 'unknown'}`);
    }

    /**
     * 取消选中
     */
    public deselectItem(): void {
        if (this._selectedItem) {
            const comp = this.getItemComponent(this._selectedItem);
            comp?.setSelected(false);
            this._selectedItem = null;
        }
    }

    /**
     * 判断物品是否被选中
     */
    public isSelected(itemNode: Node): boolean {
        return this._selectedItem === itemNode;
    }

    /**
     * 获取当前选中的物品
     */
    public getSelectedItem(): Node | null {
        return this._selectedItem;
    }

    // ==================== 发射器发射 ====================

    /**
     * 发射一个物品（供点击和长按共用）
     * @param forceChainId 可选，强制只产出该 chainId 线路的物品（GM 一键完成订单用）
     * @returns 发射成功返回 true，失败（体力不足/棋盘满）返回 false
     */
    public fireGenerator(itemNode: Node, forceChainId?: string): boolean {
        const itemComponent = this.getItemComponent(itemNode);
        const itemData = itemComponent?.data;
        if (!itemData || !itemData.isGenerator) {
            return false;
        }

        const result = GeneratorManager.instance.generate(itemData, forceChainId);
        if (!result) {
            return false;
        }

        const node = this.spawnItemWithData(result.outputItemData, result.targetCol, result.targetRow, 0.5);
        if (!node) {
            console.error('[ItemManager] Failed to spawn generator output');
            return false;
        }

        console.log(`[Generator] Spawn: ${result.outputItemData.itemId} at Cell(${result.targetCol},${result.targetRow})`);

        // 播放发射器发射音效
        AudioManager.instance.playSFX(AudioManager.SFX_GENERATOR_FIRE);

        if (result.generatorExhausted) {
            if (this.isSelected(itemNode)) {
                this.deselectItem();
            }
            this.destroyItem(itemNode);
            console.log(`[Generator] ${itemData.itemId} destroyed: life exhausted`);
        }
        return true;
    }

    /**
     * 处理物品点击
     * - 未选中 → 选中（显示选中特效）
     * - 已选中且是发射器 → 发射一个物品
     */
    public handleItemClick(itemNode: Node): void {
        if (!this.isSelected(itemNode)) {
            this.selectItem(itemNode);
            return;
        }
        this.fireGenerator(itemNode);
    }

    /**
     * 使用现有 ItemData 在指定棋盘格子生成一个物品
     * @param itemData 物品数据
     * @param col      棋盘列
     * @param row      棋盘行
     * @param startScale 初始缩放，默认 1
     * @returns        生成的物品节点
     */
    public spawnItemWithData(itemData: ItemData, col: number, row: number, startScale: number = 1): Node | null {
        if (!this._itemPrefab || !this._boardRoot) {
            console.error('[ItemManager] prefab or boardRoot not initialized, please call init() first');
            return null;
        }

        const boardManager = this._boardManager;
        if (!boardManager) {
            console.error('[ItemManager] BoardManager not initialized');
            return null;
        }

        const cell = boardManager.getCell(col, row);
        if (!cell || !cell.isEmpty()) {
            console.error(`[ItemManager] cell (${col}, ${row}) is not empty`);
            return null;
        }

        const node = instantiate(this._itemPrefab);
        if (!node) {
            console.error('[ItemManager] instantiate prefab failed');
            return null;
        }

        node.setParent(this._boardRoot);

        const itemComponent = this.getItemComponent(node);
        if (!itemComponent) {
            console.error('[ItemManager] item prefab does not have Item component');
            return null;
        }

        // 更新物品数据的位置信息
        itemData.col = col;
        itemData.row = row;

        // 关联组件与数据
        itemComponent.data = itemData;

        // 记录到棋盘数据
        boardManager.setItem(col, row, itemData);

        // 获取格子世界坐标并摆放节点
        const worldPos = boardManager.getCellWorldPos(col, row);
        if (worldPos) {
            node.position = this.worldToLocal(worldPos);
        }

        // 如果指定了初始缩放，播放缩放动画
        if (startScale !== 1) {
            node.scale = new Vec3(startScale, startScale, 1);
            tween(node)
                .to(0.15, { scale: new Vec3(1, 1, 1) })
                .start();
        }

        EventManager.instance.emit(EventManager.ITEM_SPAWNED, itemData);
        return node;
    }

    /**
     * 处理物品拖拽结束后的落点逻辑
     * @param itemNode  被拖拽的物品节点
     * @param originCol 拖拽起始列
     * @param originRow 拖拽起始行
     * @param dropCell  落点格子，null 表示无效区域
     */
    public handleItemDrop(itemNode: Node, originCol: number, originRow: number, dropCell: Cell | null): void {
        const boardManager = this._boardManager;
        if (!boardManager) {
            console.error('[ItemManager] BoardManager not initialized');
            return;
        }

        const itemComponent = this.getItemComponent(itemNode);
        if (!itemComponent) {
            console.error('[ItemManager] itemNode does not have Item component');
            return;
        }

        const itemData = itemComponent.data;
        if (!itemData) {
            console.error('[ItemManager] itemComponent does not have ItemData');
            return;
        }

        // 无效落点：回弹到原始位置
        if (!dropCell) {
            console.log(`[Item] Drop: ${itemData.itemId} -> invalid cell`);
            this.bounceBack(itemNode, originCol, originRow);
            return;
        }

        console.log(`[Item] Drop: ${itemData.itemId} -> Cell(${dropCell.col},${dropCell.row})`);

        // 目标为空：正常移动
        if (dropCell.isEmpty()) {
            this.moveItemToCell(itemNode, itemData, originCol, originRow, dropCell.col, dropCell.row);
            return;
        }

        // 目标非空：尝试合成
        const targetItemData = dropCell.getItem();
        if (!targetItemData) {
            console.error('[ItemManager] target cell data is null');
            this.bounceBack(itemNode, originCol, originRow);
            return;
        }

        console.log(`[Merge] Try merge: ${itemData.itemId} + ${targetItemData.itemId}`);

        if (!MergeManager.instance.canMerge(itemData, targetItemData)) {
            // 不能合成：交换两个物品的位置
            this.swapItems(itemNode, itemData, originCol, originRow, targetItemData, dropCell.col, dropCell.row);
            return;
        }
        // 可以合成
        const mergeManager = MergeManager.instance;
        const nextItemId = mergeManager.merge(itemData, targetItemData);
        if (!nextItemId) {
            console.error('[ItemManager] merge returned null, should not happen after canMerge');
            this.bounceBack(itemNode, originCol, originRow);
            return;
        }

        this.executeMerge(itemNode, itemData, originCol, originRow, targetItemData, dropCell.col, dropCell.row, nextItemId);
    }

    /**
     * 执行合成
     * @param dragNode       被拖拽的物品节点
     * @param dragItemData   被拖拽物品数据
     * @param originCol      被拖拽物品起始列
     * @param originRow      被拖拽物品起始行
     * @param targetItemData 目标物品数据
     * @param targetCol      目标列
     * @param targetRow      目标行
     * @param nextItemId     合成后的新 itemId
     */
    private executeMerge(
        dragNode: Node,
        dragItemData: ItemData,
        originCol: number,
        originRow: number,
        targetItemData: ItemData,
        targetCol: number,
        targetRow: number,
        nextItemId: string
    ): void {
        console.log(`[Merge] Merge start: Cell(${originCol},${originRow}) + Cell(${targetCol},${targetRow})`);
        console.log(`[Merge] Result: ${nextItemId}`);

        const boardManager = this._boardManager;
        if (!boardManager) {
            console.error('[ItemManager] BoardManager not initialized during merge');
            return;
        }

        // 获取目标节点
        const targetNode = this.findItemNodeByData(targetItemData);

        // 立即清理棋盘数据，避免数据不一致
        boardManager.removeItem(originCol, originRow);
        boardManager.removeItem(targetCol, targetRow);

        // 确保视觉上先完成合成动画，再生成新物品
        // 提前播放合成爆炸特效，和物品缩小动画同时开始
        this.playMergeExplosion(targetCol, targetRow);

        // 确保视觉上先完成合成动画，再生成新物品
        // 确保视觉上先完成合成动画，再生成新物品
        this.animateMerge(dragNode, targetNode, () => {
            // 销毁旧节点
            this.safeDestroyItem(dragNode, dragItemData);
            if (targetNode) {
                this.safeDestroyItem(targetNode, targetItemData);
            }

            // 创建合成后的新物品
            const newItemConfig = ConfigManager.instance.getItemConfig(nextItemId);
            const newItemData = new ItemData({
                itemId: nextItemId,
                chainId: dragItemData.chainId,
                level: dragItemData.level + 1,
                maxLevel: newItemConfig?.maxLevel ?? 0,
                isGenerator: newItemConfig?.isGenerator ?? false,
            });

            // 如果合成结果是发射器（如蓝莓LV5→果酱发射器），从 generators.json 读取寿命
            if (newItemConfig?.isGenerator) {
                const genConfig = ConfigManager.instance.getGeneratorConfig(nextItemId);
                if (genConfig && typeof genConfig.life === 'number') {
                    newItemData.generatorLife = genConfig.life;
                }
            }

            const newNode = this.spawnItemWithData(newItemData, targetCol, targetRow);
            if (!newNode) {
                console.error(`[ItemManager] failed to spawn merged item: ${nextItemId}`);
                return;
            }

            // 合成动画：从 0.7 缩放到 1
            newNode.scale = new Vec3(0.7, 0.7, 1);
            tween(newNode)
                .to(0.15, { scale: new Vec3(1, 1, 1) })
                .start();

            console.log(`[Merge] Merge complete: ${nextItemId} at Cell(${targetCol},${targetRow})`);
            console.log(`[Merge] Merge complete: ${nextItemId} at Cell(${targetCol},${targetRow})`);
            // 播放合成音效（根据合成后的物品等级）
            AudioManager.instance.playMergeSFX(newItemData.level);
            EventManager.instance.emit(EventManager.ITEM_MERGED, newItemData);
        });
    }

    /**
     * 合成动画：两个节点缩小到 0 后销毁
     */
    private animateMerge(nodeA: Node, nodeB: Node | null, callback: () => void): void {
        const scaleToZero = { scale: new Vec3(0, 0, 1) };

        tween(nodeA)
            .to(0.15, scaleToZero)
            .start();

        if (nodeB) {
            tween(nodeB)
                .to(0.15, scaleToZero)
                .start();
        }

        // 动画结束后回调
        tween(nodeA)
            .delay(0.15)
            .call(callback)
            .start();
    }


    /**
     * 播放合成爆炸特效（PNG序列帧，播放一次后销毁）
     * @param col 目标格子列
     * @param row 目标格子行
     */
    private playMergeExplosion(col: number, row: number): void {
        if (!this._boardRoot || !this._boardManager) return;

        const playWithFrames = (frames: SpriteFrame[]) => {
            if (frames.length === 0) return;

            const effectNode = new Node('MergeExplosion');
            const transform = effectNode.addComponent(UITransform);
            transform.setAnchorPoint(0.5, 0.5);
            transform.setContentSize(ItemManager.MERGE_EXPLOSION_SIZE, ItemManager.MERGE_EXPLOSION_SIZE);

            const sprite = effectNode.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.spriteFrame = frames[0];

            // 设置位置到目标格子
            const cellPos = this._boardManager!.getCellWorldPos(col, row);
            if (cellPos) {
                const localPos = this._boardRoot!.getComponent(UITransform)?.convertToNodeSpaceAR(cellPos);
                if (localPos) {
                    effectNode.setPosition(localPos);
                }
            }

            effectNode.setParent(this._boardRoot);
            // 放到最上层，确保不被物品挡住
            effectNode.setSiblingIndex(this._boardRoot.children.length - 1);

            // 顺序播放一次，播完销毁
            let frameIndex = 0;
            const interval = 1000 / ItemManager.MERGE_EXPLOSION_FPS;
            const timer = window.setInterval(() => {
                if (!effectNode.isValid) {
                    clearInterval(timer);
                    return;
                }
                // 每帧都保持在最上层，避免新创建的物品盖住特效
                if (effectNode.parent) {
                    effectNode.setSiblingIndex(effectNode.parent.children.length - 1);
                }
                frameIndex++;
                if (frameIndex >= frames.length) {
                    clearInterval(timer);
                    effectNode.destroy();
                    return;
                }
                sprite.spriteFrame = frames[frameIndex];
            }, interval);
        };

        // 已有缓存直接播放，否则加载并缓存
        if (ItemManager._mergeExplosionFrames) {
            playWithFrames(ItemManager._mergeExplosionFrames);
        } else {
            resources.loadDir(ItemManager.MERGE_EXPLOSION_PATH, Texture2D, (err, textures) => {
                if (err || !textures || textures.length === 0) {
                    console.warn(`[ItemManager] 合成爆炸序列帧加载失败: ${ItemManager.MERGE_EXPLOSION_PATH}`);
                    return;
                }
                textures.sort((a, b) => a.name.localeCompare(b.name));
                const frames = textures.map(tex => {
                    const sf = new SpriteFrame();
                    sf.texture = tex;
                    return sf;
                });
                ItemManager._mergeExplosionFrames = frames;
                console.log(`[ItemManager] 合成爆炸序列帧加载成功: ${frames.length} 帧`);
                playWithFrames(frames);
            });
        }
    }
    /**
     * 移动物品到目标格子
     */
    private moveItemToCell(itemNode: Node, itemData: ItemData, originCol: number, originRow: number, targetCol: number, targetRow: number): void {
        const boardManager = this._boardManager;
        if (!boardManager) {
            return;
        }

        // 更新棋盘数据
        boardManager.removeItem(originCol, originRow);
        boardManager.setItem(targetCol, targetRow, itemData);

        // 立即更新数据，避免动画过程中再次拖拽导致数据不一致
        itemData.col = targetCol;
        itemData.row = targetRow;

        const targetWorldPos = boardManager.getCellWorldPos(targetCol, targetRow);
        if (!targetWorldPos) {
            console.error('[ItemManager] target cell world position is null');
            return;
        }

        tween(itemNode)
            .to(0.15, { position: this.worldToLocal(targetWorldPos) })
            .start();
    }

    /**
    /**
     * 交换两个物品的位置（不能合成时调用）
     * @param dragNode       被拖拽的物品节点
     * @param dragItemData   被拖拽物品数据
     * @param originCol      被拖拽物品起始列
     * @param originRow      被拖拽物品起始行
     * @param targetItemData 目标物品数据
     * @param targetCol      目标列
     * @param targetRow      目标行
     */
    private swapItems(
        dragNode: Node,
        dragItemData: ItemData,
        originCol: number,
        originRow: number,
        targetItemData: ItemData,
        targetCol: number,
        targetRow: number
    ): void {
        const boardManager = this._boardManager;
        if (!boardManager) {
            return;
        }

        // 找到目标物品的节点
        const targetNode = this.findItemNodeByData(targetItemData);

        // 更新棋盘数据：两个格子的物品互换
        boardManager.setItem(originCol, originRow, targetItemData);
        boardManager.setItem(targetCol, targetRow, dragItemData);

        // 立即更新两个物品的 col/row 数据，避免动画过程中数据不一致
        targetItemData.col = originCol;
        targetItemData.row = originRow;
        dragItemData.col = targetCol;
        dragItemData.row = targetRow;

        // 获取两个格子的世界坐标
        const originWorldPos = boardManager.getCellWorldPos(originCol, originRow);
        const targetWorldPos = boardManager.getCellWorldPos(targetCol, targetRow);
        if (!originWorldPos || !targetWorldPos) {
            return;
        }

        // 同时播放两个物品的位移动画
        tween(dragNode)
            .to(0.15, { position: this.worldToLocal(targetWorldPos) })
            .start();

        if (targetNode && targetNode.isValid) {
            tween(targetNode)
                .to(0.15, { position: this.worldToLocal(originWorldPos) })
                .start();
        }
    }

    /**
     * 回弹到原始位置
     */
    private bounceBack(itemNode: Node, originCol: number, originRow: number): void {
        const boardManager = this._boardManager;
        if (!boardManager) {
            return;
        }

        const originWorldPos = boardManager.getCellWorldPos(originCol, originRow);
        if (!originWorldPos) {
            return;
        }

        tween(itemNode)
            .to(0.15, { position: this.worldToLocal(originWorldPos) })
            .start();
    }

    /**
    /**

    /**
     * 销毁指定物品节点，并清理棋盘数据
     * @param itemNode 要销毁的物品节点
     */
    public destroyItem(itemNode: Node): void {
        const itemComponent = this.getItemComponent(itemNode);
        if (!itemComponent) {
            console.error('[ItemManager] itemNode does not have Item component');
            return;
        }

        const itemData = itemComponent.data;
        if (itemData) {
            const boardManager = this._boardManager;
            if (boardManager) {
                boardManager.removeItem(itemData.col, itemData.row);
            }
        }

        itemNode.destroy();
    }

    /**
     * 安全销毁物品节点，避免重复清理棋盘
     */
    private safeDestroyItem(itemNode: Node, itemData: ItemData): void {
        // 棋盘数据已在 executeMerge 中清理，这里只销毁节点
        if (itemNode && itemNode.isValid) {
            itemNode.destroy();
        }
    }

    /**
     * 根据 ItemData 查找对应的物品节点（在当前棋盘父节点下查找）
     * 注意：这是一个简化实现，假设棋盘下物品节点数不多
     */
    private findItemNodeByData(itemData: ItemData): Node | null {
        if (!this._boardRoot) {
            return null;
        }

        for (const child of this._boardRoot.children) {
            const itemComponent = this.getItemComponent(child);
            if (itemComponent && itemComponent.data === itemData) {
                return child;
            }
        }
        return null;
    }

    /**
     * 获取节点上的 Item 组件
     * 使用字符串名称获取，避免 Item 与 ItemManager 之间的循环依赖
     */
    private getItemComponent(node: Node): ItemComponentLike | null {
        return node.getComponent('Item') as unknown as ItemComponentLike | null;
    }

    /**
     * 将世界坐标转换为棋盘父节点下的本地坐标
     */
    private worldToLocal(worldPos: Vec3): Vec3 {
        if (!this._boardRoot) {
            return new Vec3(worldPos.x, worldPos.y, 0);
        }
        const rootWorldPos = this._boardRoot.getWorldPosition();
        return new Vec3(
            worldPos.x - rootWorldPos.x,
            worldPos.y - rootWorldPos.y,
            0
        );
    }
}

/**
 * Item 组件的最小接口，用于避免 ItemManager 直接引用 Item 类导致的循环依赖
 */
interface ItemComponentLike {
    data: ItemData | null;
}
