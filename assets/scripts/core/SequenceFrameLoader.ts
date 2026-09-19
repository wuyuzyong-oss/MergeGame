import { resources, SpriteFrame, Texture2D } from 'cc';

/**
 * 序列帧加载器
 *
 * 为什么不用 resources.loadDir(path, Texture2D)：
 * Cocos Creator 3.x 中，PNG 以 "texture" 类型导入后，主资源会 redirect 到 @xxxx 子资源。
 * - 编辑器预览：loadDir 返回的 Texture2D 的 .name 是文件名（如 "00000"），可以按 name 排序
 * - Web Build：loadDir 返回的是子资源 Texture2D，所有 .name 都是 "texture"，
 *   sort((a,b) => a.name.localeCompare(b.name)) 完全失效，帧顺序被打乱成 bundle 内部顺序，
 *   表现为动画"疯狂闪烁 / 非常快"。
 *
 * 解决方案：显式按文件名逐个加载 `{dirPath}/{name}/texture` 子资源路径，
 * 用数组下标保证顺序，编辑器和 build 行为统一。
 */

/**
 * 按文件名顺序加载序列帧
 * @param dirPath    资源目录（不含末尾斜杠），如 'textures/effect/generator_star'
 * @param filenames  文件名数组（不含扩展名），如 ['00000','00001',...]
 * @param onComplete 全部加载完成后回调，返回按 filenames 顺序排列的 SpriteFrame 数组
 *                   （加载失败的帧会被跳过，但相对顺序保持不变）
 */
export function loadSequenceFrames(
    dirPath: string,
    filenames: string[],
    onComplete: (frames: SpriteFrame[]) => void
): void {
    if (!filenames || filenames.length === 0) {
        onComplete([]);
        return;
    }

    const slots: (SpriteFrame | null)[] = new Array(filenames.length).fill(null);
    let doneCount = 0;
    const total = filenames.length;

    const finish = (): void => {
        doneCount++;
        if (doneCount === total) {
            // 过滤掉加载失败的 null 槽位，保持相对顺序
            const frames: SpriteFrame[] = [];
            for (let i = 0; i < slots.length; i++) {
                const sf = slots[i];
                if (sf) frames.push(sf);
            }
            onComplete(frames);
        }
    };

    for (let i = 0; i < total; i++) {
        const name = filenames[i];
        const index = i;
        // 主路径：子资源寻址（Web Build 唯一可靠的方式）
        const subPath = `${dirPath}/${name}/texture`;
        resources.load(subPath, Texture2D, (err, texture) => {
            if (!err && texture) {
                const sf = new SpriteFrame();
                sf.texture = texture;
                slots[index] = sf;
                finish();
                return;
            }
            // 兜底：直接路径（某些编辑器预览场景可能走这条）
            resources.load(`${dirPath}/${name}`, Texture2D, (err2, tex2) => {
                if (!err2 && tex2) {
                    const sf = new SpriteFrame();
                    sf.texture = tex2;
                    slots[index] = sf;
                } else {
                    console.warn(`[SeqLoader] 帧加载失败: ${dirPath}/${name}`, err2 || err);
                }
                finish();
            });
        });
    }
}

/** 0 填充到指定长度（避免依赖 String.prototype.padStart，兼容低版本 lib 配置） */
function padZero(num: number, length: number): string {
    let s = String(num);
    while (s.length < length) s = '0' + s;
    return s;
}

/**
 * 生成纯数字序列文件名（5 位 0 填充）
 * 例：generateNumberedNames(0, 32) → ['00000','00001',...,'00031']
 * @param start 起始数字（含）
 * @param count 帧数
 * @param padLength 0 填充长度，默认 5
 */
export function generateNumberedNames(start: number, count: number, padLength: number = 5): string[] {
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
        result.push(padZero(start + i, padLength));
    }
    return result;
}

/**
 * 生成带前缀的数字序列文件名（5 位 0 填充）
 * 例：generatePrefixedNames('abc_', 0, 3) → ['abc_00000','abc_00001','abc_00002']
 * @param prefix 文件名前缀
 * @param start  起始数字（含）
 * @param count  帧数
 * @param padLength 0 填充长度，默认 5
 */
export function generatePrefixedNames(prefix: string, start: number, count: number, padLength: number = 5): string[] {
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
        result.push(prefix + padZero(start + i, padLength));
    }
    return result;
}
