// chain-flow.js

import { EventBus } from './event-bus.js';
import { gameState, updatePhase } from './main.js';
// (※ Arbiter は v25 で不要になった)
// import { Arbiter } from './arbiter.js';
import { findTriggers } from './trigger-engine.js';
import { resolveEffects } from './effect-engine.js';
import { startStackResolutionPhase } from './stack-flow.js';
import { payAbilityCost } from './cost-engine.js'; // ★ コスト支払い

/**
 * チェーン・フローのメインループ（裁判の進行役）
 * gameState.isChainResolving が true の間、呼び出され続ける。
 */
export function processGameFlow() {
    // 1. 独立ゲームが終了しているか？
    if (!gameState.isChainResolving) return;

    // 2. スタックが空か？
    if (gameState.chainStack.length === 0) {
        // --- 裁判終了 ---
        gameState.isChainResolving = false;
        console.log("[ChainFlow] チェーン解決終了。");

        // 3. プール解決（積み残し）があるか？ (v27: フラグではなく直接見る)
        if (gameState.stackPool.player.length > 0 || gameState.stackPool.opponent.length > 0) {
            console.log("[ChainFlow] プール解決フェイズに移行します。");
            startStackResolutionPhase(); // ★ stack-flow.js を呼び出す
        } else {
            // 4. 通常のゲームフローに戻る
            updatePhase(gameState.previousPhase || 'main'); 
        }
        return;
    }

    // 5. スタックの一番上を見る (まだ取り出さない)
    const currentBundle = gameState.chainStack[gameState.chainStack.length - 1];

    // 6. 状態に応じて処理を分岐 (v25)
    switch (currentBundle.confirmationStatus) {
        case 'unconfirmed_const':
            // --- ステップ2: Const誘発探索 & バンドル化 ---
            checkForConstCascade(currentBundle);
            break;
        case 'unconfirmed_chain':
            // --- ステップ3: Chain誘発探索 ---
            checkForChainResponse(currentBundle);
            break;
        case 'confirmed_resolve':
            // --- ステップ4, 5, 6: 解決 & Pool誘発 ---
            resolveBundleAndPool();
            break;
        default:
            console.error("不明な確認ステータス:", currentBundle.confirmationStatus, currentBundle);
            gameState.isChainResolving = false;
            break;
    }
}

/**
 * ステップ2: Const誘発探索 & バンドル化 (v21 + v24)
 * スタックの一番上の「束」に反応する 'const' トリガーを探し、束ねる。
 */
function checkForConstCascade(bundle) {
    // console.log(`[ChainFlow] Const探索中... 対象:`, bundle.rootAction.card?.name || bundle.rootAction.step);

    // ★ v24ルール: v22の「使用履歴」とv23の「消費型」ルールで探索
    const constTriggers = findTriggers(
        bundle.rootAction, // 何に対して
        ['const']         // 'const' タイプだけ
    );

    if (constTriggers.length > 0) {
        // 1. 【Const発見】
        console.log(`[ChainFlow] 'const' ${constTriggers.length} 件 発見。バンドルします。`);
        
        // ★ 見つけた 'const' トリガーを「束」に追加する
        bundle.constTriggers.push(...constTriggers);
        
        // (※ v21: カスケードさせるには、再度 'unconfirmed_const' のまま
        //    新しく追加された constTriggers[0] を rootAction にして再探索...
        //    ここでは簡略化し、1段階のカスケードのみ)
        
        // ★ 'chain' 探索ステップに進む
        bundle.confirmationStatus = 'unconfirmed_chain';
        processGameFlow();

    } else {
        // 2. 【Constなし】
        // ★ 'chain' 探索ステップに進む
        bundle.confirmationStatus = 'unconfirmed_chain';
        processGameFlow();
    }
}

/**
 * ステップ3: Chain誘発探索 (v21 + v25)
 * 「束」全体に応答できる「チェーン」トリガーを探す
 */
function checkForChainResponse(bundle) {
    // console.log(`[ChainFlow] Chain探索中... 対象:`, bundle.rootAction.card?.name || bundle.rootAction.step);

    // 1. ★ 自力で 'chain' トリガーだけを探索
    const chainTriggers = findTriggers(bundle.rootAction, ['chain'], bundle);

    if (chainTriggers.length > 0) {
        // 2. 【応答あり】
        console.log(`[ChainFlow] 'chain' ${chainTriggers.length} 件 発見！ スタックに積みます。`);
        
        // ★ v25: Arbiter を呼ばず、直接スタックに積む
        const triggerToChain = chainTriggers[0]; // (※ 優先権順処理が必要)
        
        const newAction = {
            // (※ findTriggers が sourceItem を返す前提)
            card: triggerToChain.sourceItem, 
            owner: triggerToChain.sourceItem.owner,
            ability: triggerToChain.trigger.action.effects, // 実行する効果
            triggerType: 'chain'
        };

        // ★ 新しい「未確認」オブジェクトを生成し、スタックに積む
        const newBundle = {
            rootAction: newAction,
            constTriggers: [],
            confirmationStatus: 'unconfirmed_const', // ★ const探索からやり直し
            isNegated: false
        };
        gameState.chainStack.push(newBundle);
        
        // ★ ループの最初に戻る
        processGameFlow(); 

    } else {
        // 3. 【応答なし】
        // ★ 「解決可能」状態に進める
        bundle.confirmationStatus = 'confirmed_resolve';
        processGameFlow(); 
    }
}

/**
 * ステップ4, 5, 6: 本体/Const解決 & Pool誘発探索 (v21 + v24 + v27)
 */
function resolveBundleAndPool() {
    // 1. スタックから「取り出す (pop)」
    const confirmedBundle = gameState.chainStack.pop();
    
    // 2. ★ v24「消費＋履歴」ルールの実行 (解決前) ★
    applyConstUsage(confirmedBundle);

    // 3. 本体解決 & Const解決 (ステップ4)
    if (confirmedBundle.isNegated) {
        // 3a. 【無効化されている場合】
        console.log(`[ChainFlow] '${confirmedBundle.rootAction.card?.name || confirmedBundle.rootAction.step}' は無効化されたため解決しません。`);
    } else {
        // 3b. 【解決する場合】
        console.log(`[ChainFlow] '${confirmedBundle.rootAction.card?.name || confirmedBundle.rootAction.step}' (本体) を解決します...`);
        
        // --- 本体の解決 ---
        let resolvedAction = confirmedBundle.rootAction;
        if (resolvedAction.isGameAction) { 
            if (resolvedAction.event && resolvedAction.event.defaultAction) {
                resolvedAction.event.defaultAction();
            }
        } else if (resolvedAction.ability) {
            // ★ コスト支払い (Abilityのみ。Spellは payCostForPlay で支払い済み)
            if (resolvedAction.card?.type === 'Monster' || resolvedAction.triggerType) {
                 if (payAbilityCost(resolvedAction)) {
                    resolveEffects(resolvedAction.ability, resolvedAction);
                 } else {
                    console.log(`[ChainFlow] 能力コストが支払えなかったため、'${resolvedAction.card?.name}' は不発。`);
                 }
            } else {
                // (Spell の解決)
                resolveEffects(resolvedAction.ability, resolvedAction);
            }
        }
        EventBus.broadcast('ACTION_RESOLVED', { action: resolvedAction });

        // --- Const の解決 ---
        if (confirmedBundle.constTriggers.length > 0) {
            console.log(`[ChainFlow] 付随する 'const' ${confirmedBundle.constTriggers.length} 件を解決します...`);
            const constEffects = confirmedBundle.constTriggers.map(t => t.trigger.action.effects).flat();
            resolveEffects(constEffects, confirmedBundle.rootAction); // (※ コンテキストは本体)
        }
    }

    // 4. プール誘発探索 (ステップ5)
    // console.log(`[ChainFlow] 解決後の 'pool' を探します...`);
    const poolTriggers = findTriggers(confirmedBundle.rootAction, ['pool'], confirmedBundle);
    if (poolTriggers.length > 0) {
        console.log(`[ChainFlow] 'pool' ${poolTriggers.length} 件 発見！ stackPool に送ります。`);
        poolTriggers.forEach(trigger => {
            // (※ effect-engine が effect オブジェクトを生成する必要あり)
            const poolEffect = { 
                ...trigger.trigger.action, // effects 配列など
                instanceId: generateInstanceId(), // プール内で一意
                sourceCard: trigger.sourceItem,
                owner: trigger.sourceItem.owner
            }; 
            gameState.stackPool[poolEffect.owner].push(poolEffect);
        });
    }
    
    // 5. ループ または v27割り込み判断
    // (※ v27: プール解決を即時割り込み)
    if (gameState.stackPool.player.length > 0 || gameState.stackPool.opponent.length > 0) {
        console.log("[ChainFlow] プールが発見されたため、スタック解決に割り込みます。");
        gameState.isChainResolving = false; // ★ チェーンフローを一時停止
        startStackResolutionPhase();
        return; // ★ スタック解決フローに移行
    }

    // (※ プールがなければ、次のループへ)
    processGameFlow();
}


/**
 * v24（消費＋履歴）ルールを適用する（「使ったことにする」）
 */
function applyConstUsage(bundle) {
    if (!bundle || !bundle.constTriggers) return;

    bundle.constTriggers.forEach(triggerInfo => {
        const effectInstance = triggerInfo.sourceItem; // 元の継続効果インスタンス
        const triggerDef = triggerInfo.trigger;     // そのトリガーの定義
        
        // ★ 1. 「使用履歴」を更新 (v22)
        const flowLimit = triggerDef.limitPerFlow || effectInstance.limitPerFlow || 1;
        if (flowLimit !== 'none') {
            const newCount = (gameState.currentChainFlowUsedConsts.get(effectInstance.instanceId) || 0) + 1;
            gameState.currentChainFlowUsedConsts.set(effectInstance.instanceId, newCount);
            console.log(`[v24] ${effectInstance.effectKey} のフロー使用回数を ${newCount} に更新`);
        }

        // ★ 2. 「合計回数」を更新 (v23 - 消費型)
        const totalLimit = triggerDef.totalUseLimit || effectInstance.totalUseLimit || 1;
        if (totalLimit !== 'none') {
            effectInstance.currentTotalUses = (effectInstance.currentTotalUses || 0) + 1;
            console.log(`[v24] ${effectInstance.effectKey} の合計使用回数を ${effectInstance.currentTotalUses}/${totalLimit} に更新`);
            
            if (effectInstance.currentTotalUses >= totalLimit) {
                // ★ effect-engine.js の REMOVE_EFFECT を呼び出す
                console.log(`[v24] ${effectInstance.effectKey} は合計回数を使い切ったため削除されます。`);
                resolveEffects([{ type: 'REMOVE_EFFECT', target: 'self' }], { sourceEffectInstanceId: effectInstance.instanceId });
            }
        }
    });
}