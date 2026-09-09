import { Node, AudioSource, AudioClip, resources, director, game } from 'cc';

/**
 * 音频管理器
 * 负责背景音乐和音效的加载、播放、音量控制
 *
 * 音效文件路径：
 *   背景音乐：assets/resources/audio/bgm/
 *   短音效：  assets/resources/audio/sfx/
 */
export class AudioManager {
    private static _instance: AudioManager = new AudioManager();
    public static get instance(): AudioManager {
        return AudioManager._instance;
    }

    // ==================== 音频文件路径常量 ====================
    /** 背景音乐 */
    public static readonly BGM_MAIN = 'audio/bgm/bgm_main';

    /** 发射器发射音效 */
    public static readonly SFX_GENERATOR_FIRE = 'audio/sfx/sfx_generator_fire';

    /** 合成音效前缀，实际路径为 SFX_MERGE_PREFIX + 等级，如 audio/sfx/sfx_merge_3 */
    public static readonly SFX_MERGE_PREFIX = 'audio/sfx/sfx_merge_';
    /** 合成音效最高等级 */
    public static readonly SFX_MERGE_MAX_LEVEL = 13;

    /** 订单全部就绪（出现完成按钮）音效 */
    public static readonly SFX_ORDER_READY = 'audio/sfx/sfx_order_ready';

    /** 点击订单完成按钮音效 */
    public static readonly SFX_ORDER_COMPLETE = 'audio/sfx/sfx_order_complete';

    /** 金币飞向账号区音效 */
    public static readonly SFX_COIN_FLY = 'audio/sfx/sfx_coin_fly';

    /** 切换倍率音效 */
    public static readonly SFX_MULTIPLIER_SWITCH = 'audio/sfx/sfx_multiplier_switch';

    // ==================== 音量常量 ====================
    /** 背景音乐音量 */
    public static readonly BGM_VOLUME = 0.4;
    /** 音效音量 */
    public static readonly SFX_VOLUME = 0.8;

    // ==================== 内部状态 ====================
    private _audioNode: Node | null = null;
    private _bgmSource: AudioSource | null = null;
    private _sfxSource: AudioSource | null = null;
    private _clipCache: Map<string, AudioClip> = new Map();
    private _initialized = false;

    /**
     * 初始化音频管理器
     * 创建音频节点和 AudioSource 组件，预加载所有音效
     */
    public init(): void {
        if (this._initialized) return;
        this._initialized = true;

        // 创建音频节点（挂在场景根节点下，不随场景销毁）
        this._audioNode = new Node('AudioManager');
        director.getScene()?.addChild(this._audioNode);
        game.addPersistRootNode(this._audioNode);

        // 背景音乐 AudioSource（循环播放）
        this._bgmSource = this._audioNode.addComponent(AudioSource);
        this._bgmSource.loop = true;
        this._bgmSource.volume = AudioManager.BGM_VOLUME;

        // 音效 AudioSource（一次性播放）
        this._sfxSource = this._audioNode.addComponent(AudioSource);
        this._sfxSource.loop = false;
        this._sfxSource.volume = AudioManager.SFX_VOLUME;

        // 预加载所有音效
        this.preloadAll();
    }

    /**
     * 预加载所有音效文件
     */
    private preloadAll(): void {
        const paths: string[] = [
            AudioManager.BGM_MAIN,
            AudioManager.SFX_GENERATOR_FIRE,
            AudioManager.SFX_ORDER_READY,
            AudioManager.SFX_ORDER_COMPLETE,
            AudioManager.SFX_COIN_FLY,
            AudioManager.SFX_MULTIPLIER_SWITCH,
        ];

        // 合成音效 1-13 级
        for (let i = 1; i <= AudioManager.SFX_MERGE_MAX_LEVEL; i++) {
            paths.push(AudioManager.SFX_MERGE_PREFIX + i);
        }

        for (const path of paths) {
            this.loadClip(path);
        }
    }

    /**
     * 加载单个音频片段并缓存
     */
    private loadClip(path: string): void {
        if (this._clipCache.has(path)) return;

        resources.load(path, AudioClip, (err, clip) => {
            if (err) {
                console.warn(`[AudioManager] 音频加载失败: ${path}`);
                return;
            }
            this._clipCache.set(path, clip);
        });
    }

    /**
     * 播放背景音乐（循环）
     */
    public playBGM(): void {
        if (!this._bgmSource) return;

        const clip = this._clipCache.get(AudioManager.BGM_MAIN);
        if (!clip) {
            // 还没加载好，延迟重试
            resources.load(AudioManager.BGM_MAIN, AudioClip, (err, loadedClip) => {
                if (err || !loadedClip) {
                    console.warn(`[AudioManager] 背景音乐加载失败: ${AudioManager.BGM_MAIN}`);
                    return;
                }
                this._clipCache.set(AudioManager.BGM_MAIN, loadedClip);
                if (this._bgmSource && !this._bgmSource.playing) {
                    this._bgmSource.clip = loadedClip;
                    this._bgmSource.play();
                }
            });
            return;
        }

        if (!this._bgmSource.playing) {
            this._bgmSource.clip = clip;
            this._bgmSource.play();
        }
    }

    /**
     * 停止背景音乐
     */
    public stopBGM(): void {
        if (this._bgmSource && this._bgmSource.playing) {
            this._bgmSource.stop();
        }
    }

    /**
     * 播放短音效（一次性）
     * @param path 音效路径常量
     */
    public playSFX(path: string): void {
        if (!this._sfxSource) return;

        const clip = this._clipCache.get(path);
        if (!clip) {
            // 还没加载好，加载后播放
            resources.load(path, AudioClip, (err, loadedClip) => {
                if (err || !loadedClip) {
                    console.warn(`[AudioManager] 音效加载失败: ${path}`);
                    return;
                }
                this._clipCache.set(path, loadedClip);
                this._sfxSource?.playOneShot(loadedClip, AudioManager.SFX_VOLUME);
            });
            return;
        }

        this._sfxSource.playOneShot(clip, AudioManager.SFX_VOLUME);
    }

    /**
     * 播放合成音效（根据等级选择对应音效）
     * @param level 合成后的物品等级
     */
    public playMergeSFX(level: number): void {
        // 等级超过最高级时，用最高级音效
        const safeLevel = Math.min(level, AudioManager.SFX_MERGE_MAX_LEVEL);
        const path = AudioManager.SFX_MERGE_PREFIX + safeLevel;
        this.playSFX(path);
    }

    /**
     * 设置背景音乐音量
     */
    public setBGMVolume(volume: number): void {
        if (this._bgmSource) {
            this._bgmSource.volume = Math.max(0, Math.min(1, volume));
        }
    }

    /**
     * 设置音效音量
     */
    public setSFXVolume(volume: number): void {
        if (this._sfxSource) {
            this._sfxSource.volume = Math.max(0, Math.min(1, volume));
        }
    }
}
