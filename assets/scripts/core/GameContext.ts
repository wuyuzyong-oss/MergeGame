import { director, Node } from 'cc';
import type { BoardManager } from '../BoardManager';

/**
 * GameManager 组件的公共接口形状
 * 用于避免其他模块直接 import GameManager 导致的循环依赖
 *
 * 使用方式：
 *   const gm = getGameContext();
 *   gm?.boardManager.getCell(...)
 */
export interface GameContextShape {
    readonly boardManager: BoardManager | null;
    readonly boardPanel: Node | null;
    readonly orderPanel: Node | null;
}

/**
 * 运行时获取 GameManager 组件引用
 * 所有需要访问 GameManager 的模块统一使用此方法，避免静态 import 产生循环依赖
 */
export function getGameContext(): GameContextShape | null {
    const scene = director.getScene();
    if (!scene) return null;
    return (scene.getComponent('GameManager') as unknown as GameContextShape) || null;
}
