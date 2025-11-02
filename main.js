// main.js

// -----------------------------------------------------------------
// ★ 全てのモジュール（部品）をインポート
// -----------------------------------------------------------------
import { EventBus } from './event-bus.js';
import { playerDeckList, opponentDeckList } from './deck-lists.js'; 
import { createDeckFromList, shuffleDeck, drawCard, checkAndAttachGems } from './utils.js';
import { setupEventListeners as setupExecutiveListener } from './executive.js';
import { Arbiter } from './arbiter.js';
import { Renderer } from './renderer.js';
import { AIController } from './ai-controller.js';

// (※ 将来のインポート)
// import { processGameFlow } from './chain-flow.js';
// import { startStackResolutionPhase } from './stack-flow.js';

// -----------------------------------------------------------------
// ★ グローバル state と 定数
// -----------------------------------------------------------------

/**
 * ゲームの全ての状態を保持するオブジェクト。
 * 他のモジュールがこれを import して参照・変更する。
 */
export let gameState = {};
export const PLAYERS = ['player', 'opponent']; // (※ utils.js と重複)

// -----------------------------------------------------------------
// ★ 初期化
// -----------------------------------------------------------------

/**
 * ゲームを初期化する
 */
function initializeGameState() {
    gameState = {
        turnNumber: 0,
        playerTurnCount: 0,
        opponentTurnCount: 0,
        currentPlayer: 'player',
        phase: 'loading',
        previousPhase: 'set',
        
        chainStack: [],
        stackPool: { player: [], opponent: [] },
        // pendingStackResolution: false, // (※ v27: 不要)

        chainOriginType: null, // 'PLAYER', 'GAME_RULE', 'EFFECT'
        chainOriginPlayer: null, // 'player', 'opponent'

        isChainResolving: false, // チェーンフローが動作中か

        // v24: フローごとの使用履歴
        currentChainFlowUsedConsts: new Map(), 

        continuousEffects: [], // 継続効果配列
        
        player: { 
            name: 'Player',
            life: 10, 
            deck: [], hand: [], field: [], mana: [], gem: [], graveyard: [],
            setPhase: { mana: false, gem: false }
        },
        opponent: { 
            name: 'アガレス', 
            life: 10, 
            deck: [], hand: [], field: [], mana: [], gem: [], graveyard: [],
            setPhase: { mana: false, gem: false }
        }
    };

    // --- デッキの構築 ---
    gameState.player.deck = createDeckFromList(playerDeckList, 'p');
    gameState.opponent.deck = createDeckFromList(opponentDeckList, 'o');
    shuffleDeck(gameState.player.deck);
    shuffleDeck(gameState.opponent.deck);

    // --- 初期手札 ---
    for (let i = 0; i < 5; i++) {
        drawCard(gameState.player);
        drawCard(gameState.opponent);
    }

    // --- ★ リスナー登録 ★ ---
    // (※ 登録順が重要な場合がある)
    setupExecutiveListener(); // 行政府
    Arbiter.setupListener();    // 裁定者
    // (※ 他のリスナーもここに追加)

    // --- UI初期化 ---
    Renderer.initialize();

    // --- ゲーム開始 ---
    // 最初の描画
    Renderer.renderAll(gameState); 
    // 最初のターンを開始
    startTurn();
}

// -----------------------------------------------------------------
// ★ Game Flow (進行役)
// -----------------------------------------------------------------

/**
 * ターンを開始する (Game Flow)
 */
export function startTurn() {
    gameState.turnNumber++;
    const activePlayer = gameState.currentPlayer;

    if (activePlayer === 'player') {
        gameState.playerTurnCount++;
    } else {
        gameState.opponentTurnCount++;
    }

    // ★ 放送局: ターンの開始を放送（デフォルト行動を添付）
    EventBus.broadcast('START_STEP', { 
        player: activePlayer, 
        step: 'turn',
        turnCount: activePlayer === 'player' ? gameState.playerTurnCount : gameState.opponentTurnCount,
        // ★ このイベントの「デフォルト行動」 (v13)
        defaultAction: () => {
            const playerState = gameState[activePlayer];
            
            // 1. ジェム装着/破壊
            checkAndAttachGems(playerState); 
            // 2. ターン開始時のリソースセットフラグをリセット
            playerState.setPhase = { mana: false, gem: false };
            
            // Renderer.addLog(`--- ${playerState.name} のターン ${gameState.turnNumber} ---`); // (将来)
            console.log(`--- ${playerState.name} のターン ${gameState.turnNumber} ---`);
        }
    });

    // ★ 放送局: ドローステップの開始を放送（デフォルト行動を添付）
    const drawCount = (gameState.turnNumber === 1 && activePlayer === 'player') ? 1 : 2;
    EventBus.broadcast('START_STEP', { 
        player: activePlayer, 
        step: 'draw_phase',
        defaultAction: () => {
            const playerState = gameState[activePlayer];
            for (let i = 0; i < drawCount; i++) {
                drawCard(playerState);
            }
            // Renderer.addLog(`${playerState.name}がカードを${drawCount}枚引いた。`); // (将来)
            console.log(`[Main] ${playerState.name}がカードを${drawCount}枚引いた。`);
        }
    });

    // ★ セットフェイズに移行
    updatePhase('set');

    // ★ 描画とAI/UI制御
    Renderer.renderAll(gameState); // ★ 描画
    
    if (activePlayer === 'opponent') {
        AIController.startTurn(); // ★ AI 思考開始
    } else {
        // (プレイヤーの入力待ち)
    }
}

/**
 * プレイヤーが「ターン終了ボタン」を押したときの処理
 */
export function endTurnButtonHandler() {
    if (gameState.currentPlayer !== 'player' || gameState.isChainResolving || gameState.phase === 'stack_resolution') return;

    // ★ 放送局: ターンの終了を放送
    EventBus.broadcast('END_STEP', { 
        player: 'player', 
        step: 'turn',
        // ★ ターン終了の「デフォルト行動」
        defaultAction: () => {
            // Renderer.addLog('プレイヤーがターンを終了。'); // (将来)
            console.log("[Main] プレイヤーがターン終了。相手のターンへ。");
            gameState.currentPlayer = 'opponent';
            startTurn(); // ★ 次のターンを開始
        }
    });
}

/**
 * 現在のフェイズを更新する (Game Flow)
 * @param {string} newPhase - 'set', 'main', 'chain' など
 */
export function updatePhase(newPhase) {
    // (※ この関数は Arbiter や Stack Flow からも呼ばれる)
    
    if (gameState.isChainResolving && newPhase !== 'stack_resolution' && newPhase !== 'chain') {
        gameState.previousPhase = newPhase;
        return;
    }
    
    const oldPhase = gameState.phase;
    if (oldPhase === newPhase && newPhase !== 'chain') return; 

    // ★ 放送局: 古いフェイズの終了を放送
    EventBus.broadcast('END_STEP', { 
        player: gameState.currentPlayer, 
        step: 'phase', 
        phase: oldPhase 
    });

    if (newPhase === 'chain') {
        if (!gameState.isChainResolving) {
            gameState.previousPhase = gameState.phase;
        }
    } else if (newPhase === 'stack_resolution') {
        if (!gameState.isChainResolving) { // (※ chain-flow が一時停止した場合も考慮)
             gameState.previousPhase = gameState.phase;
        }
    } else if (!gameState.isChainResolving) {
        gameState.previousPhase = gameState.phase;
    }
    
    gameState.phase = newPhase;

    // ★ 放送局: 新しいフェイズの開始を放送
    EventBus.broadcast('START_STEP', { 
        player: gameState.currentPlayer, 
        step: 'phase', 
        phase: newPhase 
    });

    Renderer.renderAll(gameState); // ★ フェイズが変わったら必ず再描画
    // Renderer.updatePhaseIndicator(newPhase); // (※ renderAll がやる)
}

/**
 * ゲームを終了させる (Game Flow)
 * @param {string} winner - 'player' or 'opponent'
 */
export function endGame(winner) {
    if (gameState.phase === 'end') return;
    gameState.phase = 'end';
    
    // Renderer.showEndGameModal(winner); // (将来)
    console.log(`--- GAME END --- Winner: ${winner} ---`);
    Renderer.renderAll(gameState); // 最終状態を描画
}

// -----------------------------------------------------------------
// ★ アプリケーションの起動 (点火)
// -----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // DOM（HTML）の準備ができたら、ゲームを初期化する
    initializeGameState();
});