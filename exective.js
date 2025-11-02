// executive.js

import { EventBus } from './event-bus.js';
import { gameState } from './main.js';
// (※ Arbiter は EventBus を介して連携するため、import は不要)
// (※ findTriggers は executive 自身が持つ簡易版 findAnyTrigger を使う)

/**
 * 「行政府」
 * EventBusからの全イベントを監視し、
 * トリガーの「存在」を検知したら「裁定者(Arbiter)」に転送するリスナー。
 */
const Executive = {

    /**
     * ゲームイベントを処理するリスナー関数
     * (※ 'ACTION_DECLARED' 以外、全てのイベントを聞く)
     */
    handleGameEvents: (eventData) => {
        // 1. トリガーを探す (v13)
        const triggerExists = Executive.findAnyTrigger(eventData);

        if (triggerExists) {
            // 2. もしトリガーが「1つでも」見つかったら
            //    元のイベントをそのまま裁定者に転送（放送）する
            EventBus.broadcast('ACTION_DECLARED', {
                event: eventData, // ★ 元のイベントを内包
                origin: 'GAME_RULE'
            });

        } else {
            // 3. もしトリガーが見つからなかったら (Aルート)
            //    元のイベントの「デフォルト行動」があれば、それを即時実行する
            if (eventData.defaultAction) {
                // console.log(`[Executive] トリガーなし。デフォルト行動を実行: ${eventData.eventName}`);
                eventData.defaultAction();
            }
        }
    },

    /**
     * (v13) 現在のゲーム状態で、指定されたイベントに反応するトリガーが「存在するかどうか」だけをチェックする
     * (※ trigger-engine.js の findTriggers とロジックが重複するが、
     * v13設計では Executive が「存在確認」だけを行う)
     */
    findAnyTrigger: (eventData) => {
        const { eventName, player } = eventData;
        if (!eventName || !player) return false; 
        
        const opponent = player === 'player' ? 'opponent' : 'player';
        
        // 探索対象の配列 (手札/場/継続効果)
        const searchTargets = [
            ...(gameState[player]?.hand || []),
            ...(gameState[player]?.field || []),
            ...(gameState[opponent]?.hand || []),
            ...(gameState[opponent]?.field || []),
            ...(gameState.continuousEffects || [])
        ];

        // 1つでも見つかれば即座に true を返す
        for (const item of searchTargets) {
            if (!item.triggers || item.triggers.length === 0) continue;

            for (const trigger of item.triggers) {
                const condition = trigger.condition;
                if (!condition) continue;

                // 1. イベント名が合致するか
                if (condition.event !== eventName) continue;
                
                // 2. オーナー（self/opponent）が合致するか
                const triggerOwner = item.originalOwner || item.owner; 
                if (!triggerOwner) continue; 

                if (condition.owner === 'self' && player !== triggerOwner) continue;
                if (condition.owner === 'opponent' && player === triggerOwner) continue;
                
                // 3. (将来) その他の条件 (step, phase, source, condition関数など) をチェック
                // if (condition.step && condition.step !== eventData.step) continue;
                // if (condition.condition && !condition.condition(gameState, eventData, item)) continue;

                // --- 1つでも合致するものが見つかった ---
                // console.log(`[Executive] トリガー検知！`, eventData.eventName, item.name || item.id);
                return true; 
            }
        }
        return false;
    }
};

/**
 * ゲーム開始時に、行政府を放送局に登録する
 */
export function setupEventListeners() {
    // ★ 全てのイベントを購読する (※ `ACTION_DECLARED` は除く)
    const allEventNames = [
        'START_STEP', 
        'END_STEP', 
        'ACTION_RESOLVED', 
        'CARD_SUMMONED',
        'AFTER_ATTACK',
        'CARD_DRAWN',
        'PLAYER_DAMAGED' 
        // ... 他の全てのイベント名
    ];

    allEventNames.forEach(eventName => {
        EventBus.subscribe(eventName, Executive.handleGameEvents);
    });
}