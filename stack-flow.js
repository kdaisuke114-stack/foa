// stack-flow.js

import { EventBus } from './event-bus.js';
import { gameState, updatePhase, endGame } from './main.js';
// ★ chain-flow.js をインポート (再開のため)
import { processGameFlow } from './chain-flow.js';
// (※ Renderer は将来的に UI 表示のためにインポート)
// import { Renderer } from './renderer.js';
// (※ AIController もインポートが必要)
// import { AIController } from './ai-controller.js';

/**
 * スタック解決フェイズ（プール解決）を開始する
 */
export function startStackResolutionPhase() {
    // 1. フェイズを「スタック解決」に移行
    updatePhase('stack_resolution');

    // 2. 優先権を決定し、パス状態をリセット
    gameState.priorityHolder = gameState.currentPlayer;
    gameState.passedPriority = { player: false, opponent: false };

    console.log("[StackFlow] --- スタック解決フェイズ ---");
    console.log(`[StackFlow] 優先権は ${gameState.priorityHolder} です。`);

    // 3. 行動の確認を開始
    checkPlayerAction();
}

/**
 * 現在の優先権保持者に行動を促す
 */
function checkPlayerAction() {
    if (gameState.isChainResolving) return; // 新たなチェーンが始まったら、そちらを優先

    const holder = gameState.priorityHolder;
    const playerPool = gameState.stackPool[holder];

    if (playerPool.length > 0) {
        // --- 1. 使える効果がある場合 ---
        if (holder === 'player') {
            // Renderer.showStackModal(playerPool, true); // (true = パス可能)
            console.log("[StackFlow] あなたの優先権です。プール効果を使うかパスしてください。");
            // (※ UIからの入力を待つ)
        } else {
            // AIController.decideStackAction(playerPool, passPriority, useStackedEffect); 
            console.log("[StackFlow] アガレスが思考中です...");
            setTimeout(passPriority, 1000); // (ダミー: パス)
        }
    } else {
        // --- 2. 使える効果がない場合 ---
        if (holder === 'player') {
             // Renderer.showStackModal([], true); // (パスボタンだけ表示)
             console.log("[StackFlow] あなたの優先権です。使える効果はありません。パスしてください。");
        } else {
            console.log(`[StackFlow] ${holder} は使える効果がないため自動的にパスします。`);
            setTimeout(passPriority, 500); // 自動パス
        }
    }
}

/**
 * プレイヤーがスタックプールから効果の使用を「宣言」する
 * (※ UIやAIから呼び出される)
 */
export function useStackedEffect(owner, effectInstanceId, targetInstanceId = null) {
    if (owner !== gameState.priorityHolder) return;
    if (gameState.isChainResolving) return; 
    
    const pool = gameState.stackPool[owner];
    const effectIndex = pool.findIndex(eff => eff.instanceId === effectInstanceId);
    
    if (effectIndex === -1) {
        console.error("[StackFlow] 対象の効果がプールに見つかりません:", effectInstanceId);
        return;
    }

    // 1. プールから効果を取り出す
    const [effectToUse] = pool.splice(effectIndex, 1);
    effectToUse.targetInstanceId = targetInstanceId; // 対象をセット
    effectToUse.owner = owner; // (※ owner を action オブジェクトに含める)

    // 2. ★「裁定者(Arbiter)」に「宣言」として放送する
    EventBus.broadcast('ACTION_DECLARED', {
        action: effectToUse,
        origin: 'EFFECT' // プール効果（継続効果）からの宣言
    });
    
    // 3. 宣言したので、パス状態をリセットする
    gameState.passedPriority = { player: false, opponent: false };

    // ★ Arbiter が新しいチェーン・フローを開始する。
    //    (この関数はここで終了し、メインループは Arbiter/ChainFlow に移る)
}

/**
 * 優先権保持者が「パス」を宣言する
 */
export function passPriority() {
    if (!gameState.priorityHolder || gameState.isChainResolving) return;

    const holder = gameState.priorityHolder;
    const opponent = holder === 'player' ? 'opponent' : 'player';

    console.log(`[StackFlow] ${holder} がパスを宣言しました。`);

    // 1. パス状態を記録
    gameState.passedPriority[holder] = true;

    // 2. 両者がパスしたかチェック
    if (gameState.passedPriority.player && gameState.passedPriority.opponent) {
        // --- ★ 両者パス: スタック解決フェイズ終了 ---
        console.log("[StackFlow] 両者がパスしました。スタック解決フェイズを終了します。");
        
        // ★ (v27) チェーン・フローが一時停止していた場合は、それを再開
        if (gameState.chainStack.length > 0) {
             console.log("[StackFlow] 中断していたチェーン・フローの残りを再開します。");
             gameState.isChainResolving = true; // ★ チェーンフロー再開
             updatePhase('chain'); // (フェイズを戻す)
             processGameFlow(); // ★ chain-flow.js のメインループをキック
        } else {
             // (チェーンが完全に終了していた場合、Game Flow に戻る)
             updatePhase(gameState.previousPhase || 'main');
        }

    } else {
        // --- ★ 片方だけパス: 優先権を相手に移す ---
        gameState.priorityHolder = opponent;
        console.log(`[StackFlow] 優先権が ${opponent} に移動します。`);
        
        // 3. 相手の行動確認に移る
        checkPlayerAction();
    }
}