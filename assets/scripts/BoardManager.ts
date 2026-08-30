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

    private readonly CELL_SIZE = 80;
    private readonly CELL_SPACING = 10;

    private _boardRoot: Node | null = null;
    private _graphics: Graphics | null = null;
    private _cells: Cell[] = [];

    constructor() {
        // BoardManager 是纯 TypeScript 类，不继承 Component
    }

    public initialize(boardRoot: Node): void {
        this._boardRoot = boardRoot;
        this.createCells();
        // 棋盘格子由背景图显示，不再用 Graphics 绘制
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
        const step = this.CELL_SIZE + this.CELL_SPACING;

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

    private createGraphics(): void {
        if (!this._boardRoot) {
            return;
        }
        this._graphics = this._boardRoot.addComponent(Graphics);
    }

    private drawBoard(): void {
        console.log('[BoardManager] drawBoard started', {
            boardRoot: this._boardRoot?.name,
            cols: BoardManager.COLS,
            rows: BoardManager.ROWS,
            cellSize: this.CELL_SIZE,
            gap: this.CELL_SPACING,
        });

        if (!this._graphics) {
            console.error('[BoardManager] drawBoard failed: graphics component is null');
            return;
        }

        const totalWidth = this.getTotalWidth();
        const totalHeight = this.getTotalHeight();
        const startX = -totalWidth / 2;
        const startY = totalHeight / 2;
        const step = this.CELL_SIZE + this.CELL_SPACING;

        // 半透明白色填充 #ffffff44
        for (let row = 0; row < BoardManager.ROWS; row++) {
            for (let col = 0; col < BoardManager.COLS; col++) {
                const x = startX + col * step;
                const y = startY - row * step;
                // UI 坐标系 Y 向上，高度用负数
                this._graphics.rect(x, y, this.CELL_SIZE, -this.CELL_SIZE);
            }
        }
        this._graphics.fillColor = new Color(255, 255, 255, 68); // #ffffff44
        this._graphics.fill();

        // 黑色描边 2px
        for (let row = 0; row < BoardManager.ROWS; row++) {
            for (let col = 0; col < BoardManager.COLS; col++) {
                const x = startX + col * step;
                const y = startY - row * step;
                // UI 坐标系 Y 向上，高度用负数
                this._graphics.rect(x, y, this.CELL_SIZE, -this.CELL_SIZE);
            }
        }
        this._graphics.strokeColor = Color.BLACK;
        this._graphics.lineWidth = 2;
        this._graphics.stroke();

        console.log('[BoardManager] drawBoard finished');
    }

    private calculateCellLocalPosition(col: number, row: number): Vec2 {
        const totalWidth = this.getTotalWidth();
        const totalHeight = this.getTotalHeight();
        const startX = -totalWidth / 2;
        const startY = totalHeight / 2;
        const step = this.CELL_SIZE + this.CELL_SPACING;

        const x = startX + col * step + this.CELL_SIZE / 2;
        const y = startY - row * step - this.CELL_SIZE / 2;
        return new Vec2(x, y);
    }

    private getTotalWidth(): number {
        return BoardManager.COLS * this.CELL_SIZE + (BoardManager.COLS - 1) * this.CELL_SPACING;
    }

    private getTotalHeight(): number {
        return BoardManager.ROWS * this.CELL_SIZE + (BoardManager.ROWS - 1) * this.CELL_SPACING;
    }
}
