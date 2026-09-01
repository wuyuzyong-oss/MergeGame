import { Vec2, Vec3, Node, Graphics, Color } from 'cc';
import { Cell } from './Cell';
import { ItemData } from './ItemData';

/**
 * 棋盘管理器
 * 负责 7x9 棋格的生成、查询与坐标转换
 */
export class BoardManager {
    public static readonly COLS = 7;
    public static readonly ROWS = 9;
    public static readonly TOTAL_CELLS = BoardManager.COLS * BoardManager.ROWS;

    // 棋盘格子大小
    public static readonly CELL_SIZE = 145;
    // 棋盘格子间距 
    private readonly CELL_SPACING = 0;

    // ========= Debug 棋盘可调参数 =========
    /** 是否显示半透明 Debug 棋盘（用于与背景图对齐） */
    public static SHOW_DEBUG_BOARD = true;
    /** Debug 棋盘填充透明度 (0-255) */
    public static DEBUG_ALPHA = 10;
    /** Debug 棋盘整体 X 偏移（像素） */
    public static BOARD_OFFSET_X = 0;
    /** Debug 棋盘整体 Y 偏移（像素） */
    public static BOARD_OFFSET_Y = 0;
    // ======================================

    private _boardRoot: Node | null = null;
    private _debugRoot: Node | null = null;
    private _graphics: Graphics | null = null;
    private _cells: Cell[] = [];

    constructor() {
        // BoardManager 是纯 TypeScript 类，不继承 Component
    }

    /**
     * @param boardRoot  棋盘逻辑根节点（物品挂到此节点下）
     * @param debugRoot  可选，Debug 棋盘视觉节点（Graphics 画到此节点上）
     *                   如果不传，则使用 boardRoot
     */
    public initialize(boardRoot: Node, debugRoot?: Node): void {
        this._boardRoot = boardRoot;
        this._debugRoot = debugRoot ?? boardRoot;
        this.createCells();
        this.drawDebugBoard();
        console.log('BoardManager initialized');
        console.log(`Board created: ${BoardManager.COLS} x ${BoardManager.ROWS}`);
        console.log(`Cell count: ${BoardManager.TOTAL_CELLS}`);
    }

    /**
     * 根据行列索引获取格子
     */
    public getCell(col: number, row: number): Cell | null {
        if (!this.isValidPosition(col, row)) {
            return null;
        }
        return this._cells[row * BoardManager.COLS + col];
    }

    /**
     * 判断行列索引是否合法
     */
    public isValidPosition(col: number, row: number): boolean {
        return col >= 0 && col < BoardManager.COLS && row >= 0 && row < BoardManager.ROWS;
    }

    /**
     * 判断某个格子是否为空
     */
    public isCellEmpty(col: number, row: number): boolean {
        const cell = this.getCell(col, row);
        return cell !== null && cell.isEmpty();
    }

    /**
     * 在指定格子设置物品
     */
    public setItem(col: number, row: number, item: ItemData): boolean {
        const cell = this.getCell(col, row);
        if (!cell) {
            return false;
        }
        cell.setItem(item);
        return true;
    }

    /**
     * 移除指定格子的物品
     */
    public removeItem(col: number, row: number): ItemData | null {
        const cell = this.getCell(col, row);
        if (!cell) {
            return null;
        }
        return cell.removeItem();
    }

    /**
     * 获取指定格子的物品
     */
    public getItem(col: number, row: number): ItemData | null {
        const cell = this.getCell(col, row);
        return cell ? cell.getItem() : null;
    }

    /**
     * 清空棋盘上的所有物品
     */
    public clear(): void {
        for (const cell of this._cells) {
            cell.clear();
        }
    }

    /**
     * 获取棋盘根节点
     */
    public get boardNode(): Node | null {
        return this._boardRoot;
    }

    /**
     * 获取指定行列格子的世界坐标
     */
    public getCellWorldPos(col: number, row: number): Vec3 | null {
        const cell = this.getCell(col, row);
        if (!cell || !this._boardRoot) {
            return null;
        }
        const worldPos = this._boardRoot.getWorldPosition();
        return new Vec3(
            cell.position.x + worldPos.x,
            cell.position.y + worldPos.y,
            worldPos.z
        );
    }

    /**
     * 根据世界坐标获取格子（近似查询）
     */
    public getCellByWorldPos(worldPos: Vec3): Cell | null {
        if (!this._boardRoot) {
            return null;
        }

        const rootWorldPos = this._boardRoot.getWorldPosition();
        const localX = worldPos.x - rootWorldPos.x;
        const localY = worldPos.y - rootWorldPos.y;

        const totalWidth = this.getTotalWidth();
        const totalHeight = this.getTotalHeight();
        const startX = -totalWidth / 2;
        const startY = totalHeight / 2;
        const step = BoardManager.CELL_SIZE + this.CELL_SPACING;

        const col = Math.floor((localX - startX) / step);
        const row = Math.floor((startY - localY) / step);

        return this.getCell(col, row);
    }

    private createCells(): void {
        this._cells = [];
        for (let row = 0; row < BoardManager.ROWS; row++) {
            for (let col = 0; col < BoardManager.COLS; col++) {
                const position = this.calculateCellLocalPosition(col, row);
                const cell = new Cell(col, row, position);
                this._cells.push(cell);
            }
        }
    }

    /**
     * 绘制半透明 Debug 棋盘（开发辅助，不参与游戏逻辑）
     * 用于与背景 PNG 中的棋盘格进行视觉对齐
     * 通过 SHOW_DEBUG_BOARD / DEBUG_ALPHA / BOARD_OFFSET_X / BOARD_OFFSET_Y 调节
     */
    private drawDebugBoard(): void {
        if (!this._debugRoot) return;
        if (!BoardManager.SHOW_DEBUG_BOARD) {
            console.log('[BoardManager] Debug board hidden (SHOW_DEBUG_BOARD=false)');
            return;
        }

        this._graphics = this._debugRoot.addComponent(Graphics);

        const ox = BoardManager.BOARD_OFFSET_X;
        const oy = BoardManager.BOARD_OFFSET_Y;
        const alpha = BoardManager.DEBUG_ALPHA;

        const totalWidth = this.getTotalWidth();
        const totalHeight = this.getTotalHeight();
        const startX = -totalWidth / 2 + ox;
        const startY = totalHeight / 2 + oy;
        const step = BoardManager.CELL_SIZE + this.CELL_SPACING;

        const cornerRadius = 8; // 圆角半径

        // 棋盘格交替填充：(row + col) % 2 == 0 为黑色半透明，否则全透明
        for (let row = 0; row < BoardManager.ROWS; row++) {
            for (let col = 0; col < BoardManager.COLS; col++) {
                if ((row + col) % 2 !== 0) {
                    continue; // 全透明格子，跳过
                }
                const x = startX + col * step;
                const y = startY - row * step - BoardManager.CELL_SIZE; // 左下角 y
                this._graphics.roundRect(x, y, BoardManager.CELL_SIZE, BoardManager.CELL_SIZE, cornerRadius);
            }
        }
        this._graphics.fillColor = new Color(0, 0, 0, alpha); // 黑色半透明
        this._graphics.fill();

        console.log(`[BoardManager] Debug board drawn (alpha=${alpha}, cornerRadius=${cornerRadius})`);
    }

    private calculateCellLocalPosition(col: number, row: number): Vec2 {
        const totalWidth = this.getTotalWidth();
        const totalHeight = this.getTotalHeight();
        const startX = -totalWidth / 2;
        const startY = totalHeight / 2;
        const step = BoardManager.CELL_SIZE + this.CELL_SPACING;

        const x = startX + col * step + BoardManager.CELL_SIZE / 2;
        const y = startY - row * step - BoardManager.CELL_SIZE / 2;
        return new Vec2(x, y);
    }

    private getTotalWidth(): number {
        return BoardManager.COLS * BoardManager.CELL_SIZE + (BoardManager.COLS - 1) * this.CELL_SPACING;
    }

    private getTotalHeight(): number {
        return BoardManager.ROWS * BoardManager.CELL_SIZE + (BoardManager.ROWS - 1) * this.CELL_SPACING;
    }
}
