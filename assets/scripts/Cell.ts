import { Vec2 } from 'cc';
import { ItemData } from './ItemData';

/**
 * 棋盘格子
 * 维护所在行列、世界坐标、当前占用物品数据
 */
export class Cell {
    public col: number = 0;
    public row: number = 0;
    public position: Vec2 = new Vec2(0, 0);
    public item: ItemData | null = null;

    constructor(col: number, row: number, position: Vec2) {
        this.col = col;
        this.row = row;
        this.position = position;
    }

    /**
     * 判断格子是否为空
     */
    public isEmpty(): boolean {
        return this.item === null;
    }

    /**
     * 设置格子内物品数据
     */
    public setItem(item: ItemData | null): void {
        this.item = item;
    }

    /**
     * 获取格子内物品数据
     */
    public getItem(): ItemData | null {
        return this.item;
    }

    /**
     * 移除并返回格子内物品数据
     */
    public removeItem(): ItemData | null {
        const removed = this.item;
        this.item = null;
        return removed;
    }

    /**
     * 清空格子
     */
    public clear(): void {
        this.item = null;
    }
}
