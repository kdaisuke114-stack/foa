// arbiter.js

import { EventBus } from './event-bus.js';
import { gameState, updatePhase } from './main.js';
// ★ 将来作成する chain-flow.js から processGameFlow をインポートする想定
import { processGameFlow } from './chain-flow.js'; 

/**
 * 「裁定者」
 * 全ての「宣言」を受け取り、v24使用履歴をリセットし、チェーンフローを開始する。
 */
export const Arbiter = {

    /**
     * `ACTION_DECLARED` イベントを処理するリスナー関数
     */
    handleAction: (eventData) => {
        const { action, event, origin } = eventData;

        // 1. 宣言された本体（アクション or イベント）を取得
        const declaredItem = action || event;
        if (!declaredItem) {
            console.error("[Arbiter] 宣言されたアイテムがありません。", eventData);
            return;
        }

        // 2. 宣言主（プレイヤー）を取得
        const actingPlayer = declaredItem.owner || declaredItem.player;
        if (!actingPlayer) {
            console.error("[Arbiter] 宣言主が不明です。", eventData);
            return;
        }

        // 3. 裁定者が「発生源」と「宣言主」を決定・記録する
        if (!gameState.isChainResolving) {
            // ★ 宣言の「種類」を裁定
            gameState.chainOriginType = origin; // 'PLAYER', 'GAME_RULE', 'EFFECT'
            
            // ★「誰が」宣言したかを裁定
            gameState.chainOriginPlayer = actingPlayer; 
            
            // ★★★ v24: 新しいフローが始まるので「使用履歴」をリセット ★★★
            gameState.currentChainFlowUsedConsts.clear();
            
            // ★ 裁定者だけがチェーン・フローを開始する
            updatePhase('chain'); 
            gameState.isChainResolving = true;
        }

        // 4. 裁定者が、宣言されたオブジェクトを「バンドル」の器としてスタックに積む
        // (※ v21/v24 の「バンドル」モデル)
        const newBundle = {
            rootAction: declaredItem, // 宣言/イベント本体
            constTriggers: [], // これから探索する const がここに入る
            confirmationStatus: 'unconfirmed_const', // ★ const探索からスタート
            isNegated: false
        };
        
        gameState.chainStack.push(newBundle);
        
        // 5. 裁定者が、チェーン処理を開始/続行する
        // (※ processGameFlow は chain-flow.js で定義される)
        processGameFlow(); 
    },

    /**
     * ゲーム開始時に、裁定者を放送局に登録する
     */
    setupListener: () => {
        // ★ `ACTION_DECLARED` のみを聞く
        EventBus.subscribe('ACTION_DECLARED', Arbiter.handleAction);
    }
};