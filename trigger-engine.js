// trigger-engine.js

import { gameState } from './main.js';
import { getZoneReference } from './utils.js';

// 探索する全プレイヤー
const PLAYERS = ['player', 'opponent'];
// 探索するカード領域
const CARD_ZONES = ['hand', 'field'];

/**
 * ★ 唯一の汎用トリガー探索エンジン ★
 * 指定されたコンテキスト（アクション/イベント）とタイプに合致する
 * 全てのトリガーを、ゲーム全体（手札/場/継続効果）から見つけ出す。
 * @param {object} context - 応答対象のアクション/イベントオブジェクト (chainStackの一番上のオブジェクト、またはExecutiveが受け取ったイベント)
 * @param {string[]} typesToFind - 探したいトリガータイプの配列 (例: ['chain'], ['const'], ['pool'])
 * @returns {Array<object>} - 見つかった「合致トリガー情報」の配列
 * (例: [{ sourceItem: (カード/効果インスタンス), trigger: (trigger定義) }, ...])
 */
export function findTriggers(context, typesToFind) {
    const results = [];
    
    // --- 1. 探索対象領域のリストを作成 ---
    const searchTargets = [...gameState.continuousEffects]; // 継続効果は常に対象
    for (const player of PLAYERS) {
        for (const zone of CARD_ZONES) {
            const zoneArray = getZoneReference(player, zone);
            if (zoneArray) {
                searchTargets.push(...zoneArray);
            }
        }
    }

    // --- 2. 探索実行 ---
    for (const item of searchTargets) {
        // (※ item は カードインスタンス または 継続効果インスタンス)
        if (!item.triggers || item.triggers.length === 0) continue;

        // --- 3. 各アイテムの全トリガーをチェック ---
        for (const trigger of item.triggers) {
            
            // ★ チェック1: タイプが合致するか？ ('chain', 'const', 'pool')
            if (!typesToFind.includes(trigger.type)) continue;

            // ★ チェック2: 条件 (condition) が合致するか？
            if (!doesConditionMatch(trigger.condition, context, item)) continue;

            // ★ チェック3: v24使用制限 (totalUseLimit / limitPerFlow) が残っているか？
            if (!isTriggerUsable(trigger, item)) continue;

            // --- 全てのチェックを通過 ---
            results.push({
                sourceItem: item,   // トリガーの発生源 (カード/効果インスタンス)
                trigger: trigger    // 合致したトリガー定義
            });
        }
    }
    
    return results;
}


// -----------------------------------------------------------------
// ★ 内部ヘルパー関数
// -----------------------------------------------------------------

/**
 * ヘルパー: トリガーの条件 (condition) がコンテキストと合致するか判定
 */
function doesConditionMatch(condition, context, sourceItem) {
    if (!condition) return false;
    
    // --- コンテキスト（何が起きたか）を正規化 ---
    let eventName, eventOwner, eventCard;

    if (context.confirmationStatus) { 
        // --- chain-flow 内の探索 ---
        // context は「バンドル」オブジェクト
        const root = context.rootAction;
        eventName = root.event?.eventName || 'ACTION_DECLARED';
        eventOwner = root.owner || root.event?.player;
        eventCard = root.card || root.event?.card;
    } else {
         // --- Executive の探索 ---
         // context は「イベント」オブジェクト
         eventName = context.eventName;
         eventOwner = context.player;
         eventCard = context.card;
    }
    
    // --- 条件判定 ---
    
    // 1. イベント名が違うか？
    if (condition.event && condition.event !== eventName) return false;
    
    // 2. オーナー（self/opponent）が違うか？
    const triggerOwner = sourceItem.originalOwner || sourceItem.owner; // カード or 継続効果
    if (condition.owner === 'self' && eventOwner !== triggerOwner) return false;
    if (condition.owner === 'opponent' && eventOwner === triggerOwner) return false;
    
    // 3. (将来) source, step, phase などのチェック
    // if (condition.source === 'self' && (eventCard?.instanceId !== sourceItem.instanceId)) return false;
    
    // 4. 追加の condition 関数 を実行
    if (condition.condition) {
        if (!condition.condition(gameState, context, sourceItem)) return false;
    }
    
    return true;
}

/**
 * ヘルパー: v24（消費＋履歴）ルールに基づき、トリガーが使用可能か判定
 */
function isTriggerUsable(trigger, sourceItem) {
    // (※ sourceItem (インスタンス) には、ADD_EFFECT 時に
    //    totalUseLimit や limitPerFlow の「現在の値」が
    //    コピーされている必要がある)
    
    const totalLimit = trigger.totalUseLimit || sourceItem.totalUseLimit || (trigger.type === 'const' ? 1 : 'none');
    const flowLimit = trigger.limitPerFlow || sourceItem.limitPerFlow || (trigger.type === 'const' ? 1 : 'none');
    
    // v24.1: 合計回数（消費型）チェック
    if (totalLimit !== 'none') {
        // (※ currentTotalUses はインスタンスが持つべきプロパティ)
        const currentTotalUses = sourceItem.currentTotalUses || 0; 
        if (currentTotalUses >= totalLimit) {
            return false;
        }
    }

    // v24.2: フロー回数（履歴型）チェック
    if (flowLimit !== 'none') {
        const usedInFlow = gameState.currentChainFlowUsedConsts.get(sourceItem.instanceId) || 0;
        if (usedInFlow >= flowLimit) {
            return false;
        }
    }
    
    return true;
}