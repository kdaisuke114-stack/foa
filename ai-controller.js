// ai-controller.js

import { EventBus } from './event-bus.js';
import { gameState, startTurn } from './main.js'; // ★ startTurn をインポート
import { CARD_DATA } from './card-data.js';
import { getZoneReference } from './utils.js';
// (※ AIの判断には cost-engine や trigger-engine も必要になる)
// import { getAvailableCostOptions } from './cost-engine.js';
// import { findTriggers } from './trigger-engine.js';

export const AIController = {
    actionQueue: [], // 実行する行動のキュー
    isThinking: false, // 思考中フラグ
    
    /**
     * AIのターンを開始する (main.js の startTurn から呼ばれる)
     */
    startTurn: () => {
        if (AIController.isThinking) return; // 既に考えていたら何もしない
        
        console.log("[AI] アガレスのターン開始。思考中...");
        AIController.actionQueue = []; // キューをリセット
        AIController.isThinking = true;
        
        // (※ AIの思考は非同期で行うのが望ましい)
        setTimeout(() => {
            AIController.processAITurn();
        }, 1000); // 1秒待って思考開始
    },
    
    /**
     * AIのターン処理 (メインロジック)
     * (※ ここにAIの思考ルーチンをv28設計に合わせて移植する)
     */
    processAITurn: () => {
        // 1. (スタブ) リソースセット
        // ... (AIがマナやジェムをセットするロジック)
        // (※ セットするたびに EventBus.broadcast('ACTION_DECLARED', ...) が必要)
        
        // 2. (スタブ) 能力使用の検討
        const abilityAction = AIController.findBestAbility();
        if (abilityAction) {
            AIController.actionQueue.push(abilityAction);
        }

        // 3. (スタブ) カードプレイの検討
        const cardAction = AIController.findBestCardToPlay();
        if (cardAction) {
            AIController.actionQueue.push(cardAction);
        }

        // 4. (スタブ) 攻撃の検討
        const attackAction = AIController.findBestAttack();
        if (attackAction) {
            AIController.actionQueue.push(attackAction);
        }

        // 5. ターン終了を追加
        AIController.actionQueue.push({ type: 'END_TURN' });

        // 6. 行動キューの実行を開始
        AIController.isThinking = false;
        AIController.executeNextAction();
    },

    /**
     * 行動キューから次の行動を実行する
     */
    executeNextAction: () => {
        // チェーン中やスタック解決中は待機
        if (gameState.isChainResolving || gameState.phase === 'stack_resolution') {
            // console.log("[AI] チェーン/スタック解決中のため待機...");
            setTimeout(AIController.executeNextAction, 1000); // 1秒後に再チェック
            return;
        }
        
        if (AIController.actionQueue.length === 0) {
             console.log("[AI] 行動キューが空です。");
             return;
        }
        
        const action = AIController.actionQueue.shift();
        
        // ★ 設計図通り、Arbiter に「宣言」として放送する
        switch (action.type) {
            case 'PLAY_CARD':
                console.log(`[AI] カード使用を宣言: ${action.payload.card.name}`);
                EventBus.broadcast('ACTION_DECLARED', {
                    action: {
                        card: action.payload.card,
                        owner: 'opponent',
                        ability: action.payload.card.ability || { type: 'summon' }, // (※ 召喚/スペル)
                        costType: action.payload.costType
                    },
                    origin: 'PLAYER' // AIもプレイヤーとして宣言
                });
                break;
            
            case 'USE_ABILITY':
                console.log(`[AI] 能力起動を宣言: ${action.payload.card.name}`);
                EventBus.broadcast('ACTION_DECLARED', {
                    action: {
                        card: action.payload.card,
                        owner: 'opponent',
                        ability: action.payload.ability,
                        cardInstanceId: action.payload.card.instanceId
                    },
                    origin: 'PLAYER'
                });
                break;
            
            case 'ATTACK':
                console.log(`[AI] 攻撃を宣言: ${action.payload.attacker.name} -> ${action.payload.target.name}`);
                EventBus.broadcast('ACTION_DECLARED', {
                    action: {
                        card: action.payload.attacker,
                        owner: 'opponent',
                        ability: { type: 'attack', text: '攻撃' }, // 攻撃もアビリティとして扱う
                        cardInstanceId: action.payload.attacker.instanceId,
                        targetInstanceId: action.payload.target.instanceId
                    },
                    origin: 'PLAYER'
                });
                break;
            
            case 'END_TURN':
                console.log("[AI] ターン終了を宣言。");
                // ★ AIもプレイヤー同様、`END_STEP` を放送する
                EventBus.broadcast('END_STEP', { 
                    player: 'opponent', 
                    step: 'turn',
                    // ★ ターン終了の「デフォルト行動」
                    defaultAction: () => {
                        console.log("[Main] アガレスがターン終了。プレイヤーのターンへ。");
                        gameState.currentPlayer = 'player';
                        startTurn(); // ★ main.js の startTurn を呼ぶ
                    }
                });
                break;
        }
        
        // (※ 次のアクションを実行する前に少し待つ)
        if (AIController.actionQueue.length > 0) {
            setTimeout(AIController.executeNextAction, 1500); // 1.5秒待つ
        }
    },
    
    // --- (以下、AIの思考ロジックのスタブ) ---
    
    findBestAbility: () => {
        // ★ AIは gameState と 汎用CARD_DATA (modification, effects) を見る
        // 例: gameState.opponent.field をループ
        //     card.ability.activated.effects を見て 'PLAYER_DAMAGE' があるか？
        //     (※ cost-engine.js の canPayCost を呼んでコストを払えるか？)
        //     (※ trigger-engine.js の isTriggerUsable でv24ルールをチェック)
        // ...
        return null; // (スタブ)
    },
    
    findBestCardToPlay: () => {
        // ★ AIは gameState.opponent.hand をループ
        //     (※ cost-engine.js の getAvailableCostOptions を呼んでコストを払えるか？)
        // ...
        return null; // (スタブ)
    },
    
    findBestAttack: () => {
        // ★ AIは gameState.opponent.field (canAttack: true) と
        //     gameState.player.field (ターゲット) を見る
        // ...
        return null; // (スタブ)
    },
    
    /**
     * スタック解決フェイズでのAIの判断 (stack-flow.js から呼ばれる)
     * @param {Array} availableEffects - stackPool['opponent']
     * @param {Function} passCallback - stack-flow.js の passPriority 関数
     * @param {Function} useCallback - stack-flow.js の useStackedEffect 関数
     */
    decideStackAction: (availableEffects, passCallback, useCallback) => {
        // ★ AIは availableEffects (stackPool) の内容を見て判断
        
        // (スタブ: とりあえず常にパス)
        setTimeout(() => {
            console.log("[AI] スタック解決をパスします。");
            passCallback(); // ★ 受け取ったコールバック（passPriority）を実行
        }, 1000);
    }
};