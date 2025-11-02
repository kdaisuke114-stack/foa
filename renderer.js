// renderer.js

// --- 連携するモジュールをインポート ---
import { gameState, endTurnButtonHandler, updatePhase } from './main.js';
import { EventBus } from './event-bus.js';
import { Arbiter } from './arbiter.js';
import { passPriority, useStackedEffect } from './stack-flow.js';
import { getZoneReference, findCard } from './utils.js';

/**
 * 「広報部 (Renderer)」
 * 全てのDOM操作とUIイベントの受付を担当する。
 * ゲームロジックを一切含まない。
 */
export const Renderer = {
    // キャッシュするDOM要素
    domElements: {
        log: null,
        modalContainer: null,
        playerField: null,
        opponentField: null,
        playerHandCards: null,
        opponentHand: null,
        playerLife: null,
        opponentLife: null,
        playerDeckCount: null,
        opponentDeckCount: null,
        playerGraveyardCount: null,
        opponentGraveyardCount: null,
        playerManaCount: null,
        opponentManaCount: null,
        playerGemCount: null,
        opponentGemCount: null,
        endTurnButton: null,
        passPriorityButton: null,
        priorityActionButton: null,
        phaseIndicator: null,
        // ... (他のモーダル用要素など)
    },

    // UI専用の状態 (gameState から分離)
    uiState: {
        selectedCard: null,      // 選択中のカードの instanceId
        selectedAttacker: null, // 攻撃中のモンスターの instanceId
        targeting: {             // ターゲティング中の情報
            active: false,
            action: null,        // 実行しようとしている action オブジェクト
            validTargets: []     // ターゲット可能な instanceId の配列
        },
        handView: 'hand', // 'hand' or 'gem' or 'mana'
        lastClick: { time: 0, cardInstanceId: null } // ダブルクリック判定用
    },

    /**
     * Renderer の初期化。
     * DOM要素をキャッシュし、全てのイベントリスナーを設定する。
     */
    initialize: () => {
        const D = Renderer.domElements;
        D.log = document.getElementById('log');
        D.modalContainer = document.getElementById('modal-container');
        D.playerField = document.getElementById('player-field');
        D.opponentField = document.getElementById('opponent-field');
        D.playerHandCards = document.getElementById('player-hand-cards');
        D.opponentHand = document.getElementById('opponent-hand');
        D.playerLife = document.getElementById('player-life');
        D.opponentLife = document.getElementById('opponent-life');
        D.playerDeckCount = document.getElementById('player-deck-count');
        D.opponentDeckCount = document.getElementById('opponent-deck-count');
        D.playerGraveyardCount = document.getElementById('player-graveyard-count');
        D.opponentGraveyardCount = document.getElementById('opponent-graveyard-count');
        D.playerManaCount = document.getElementById('player-mana-count');
        D.opponentManaCount = document.getElementById('opponent-mana-count');
        D.playerGemCount = document.getElementById('player-gem-count');
        D.opponentGemCount = document.getElementById('opponent-gem-count');
        D.endTurnButton = document.getElementById('end-turn-button');
        D.passPriorityButton = document.getElementById('pass-priority-button');
        D.priorityActionButton = document.getElementById('priority-action-button');
        D.phaseIndicator = document.getElementById('phase-indicator');
        
        // --- ★ UIイベントリスナーを全て設定 ---
        
        // ボードクリック (選択解除 / ターゲット)
        document.getElementById('game-container').addEventListener('click', (e) => {
            Renderer.onBoardClick(e);
        });
        
        // ターン終了ボタン
        D.endTurnButton.addEventListener('click', endTurnButtonHandler); // ★ main.js の endTurnButtonHandler を呼ぶ

        // パスボタン
        D.passPriorityButton.addEventListener('click', passPriority); // ★ stack-flow.js の passPriority を呼ぶ
        
        // 優先権アクションボタン (スタック/チェーン表示)
        D.priorityActionButton.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            if (action === 'show_stack') {
                Renderer.showStackModal();
            } else if (action === 'show_chain') {
                Renderer.showChainModal();
            }
        });

        // ゾーン表示クリック
        document.getElementById('player-mana-display').addEventListener('click', () => Renderer.onZoneDisplayClick('player', 'mana'));
        document.getElementById('player-gem-display').addEventListener('click', () => Renderer.onZoneDisplayClick('player', 'gem'));
        document.getElementById('player-graveyard-display').addEventListener('click', () => Renderer.onZoneDisplayClick('player', 'graveyard'));
        document.getElementById('player-deck-display').addEventListener('click', () => Renderer.onZoneDisplayClick('player', 'deck'));
        // (※ 相手ゾーンも同様に追加)
    },

    /**
     * ゲームエンジンから gameState を受け取り、画面全体を再描画する
     */
    renderAll: (gameState) => {
        const D = Renderer.domElements;
        const P = gameState.player;
        const O = gameState.opponent;

        // ライフ
        D.playerLife.textContent = P.life;
        D.opponentLife.textContent = O.life;

        // カウント
        D.playerDeckCount.textContent = P.deck.length;
        D.opponentDeckCount.textContent = O.deck.length;
        D.playerGraveyardCount.textContent = P.graveyard.length;
        D.opponentGraveyardCount.textContent = O.graveyard.length;
        D.playerManaCount.textContent = `${P.mana.filter(m => !m.tapped).length}/${P.mana.length}`;
        D.opponentManaCount.textContent = `${O.mana.filter(m => !m.tapped).length}/${O.mana.length}`;
        D.playerGemCount.textContent = P.gem.length;
        D.opponentGemCount.textContent = O.gem.length;

        // フィールド
        Renderer.renderField(P.field, 'player');
        Renderer.renderField(O.field, 'opponent');

        // 手札 (またはリソース表示)
        if (Renderer.uiState.handView === 'hand') {
            Renderer.renderHand(P.hand);
        } else {
            Renderer.renderResourceView(Renderer.uiState.handView);
        }
        Renderer.renderOpponentHand(O.hand.length);

        // UIボタンの状態
        const isPlayerTurn = gameState.currentPlayer === 'player';
        D.endTurnButton.disabled = !isPlayerTurn || gameState.isChainResolving || gameState.phase === 'stack_resolution';
        
        const canPass = (gameState.isChainResolving || gameState.phase === 'stack_resolution');
        D.passPriorityButton.classList.toggle('hidden', !canPass || gameState.priorityHolder !== 'player');
        
        Renderer.updatePriorityAction(gameState);
        Renderer.updatePhaseIndicator(gameState.phase);
    },

    /**
     * フィールドのカードを描画する
     */
    renderField: (cards, owner) => {
        const fieldEl = (owner === 'player') ? Renderer.domElements.playerField : Renderer.domElements.opponentField;
        fieldEl.innerHTML = '';
        cards.forEach(card => {
            const cardEl = Renderer.createCardDOM(card, 'field');
            fieldEl.appendChild(cardEl);
        });
    },

    /**
     * 手札のカードを描画する
     */
    renderHand: (cards) => {
        document.getElementById('hand-view-title').textContent = 'あなたの手札';
        const handEl = Renderer.domElements.playerHandCards;
        handEl.innerHTML = '';
        cards.forEach(card => {
            const cardEl = Renderer.createCardDOM(card, 'hand');
            handEl.appendChild(cardEl);
        });
    },
    
    /**
     * 相手の手札（裏側）を描画する
     */
    renderOpponentHand: (count) => {
        const handEl = Renderer.domElements.opponentHand;
        handEl.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';
            cardEl.style.backgroundImage = 'url(https://placehold.co/72x100/555/999?text=CARD)';
            cardEl.style.borderColor = '#333';
            handEl.appendChild(cardEl);
        }
    },

    /**
     * リソース（マナ・ジェム）を手札エリアに表示する
     */
    renderResourceView: (zoneName) => {
        const title = (zoneName === 'mana') ? 'あなたのマナ' : 'あなたの未使用ジェム';
        document.getElementById('hand-view-title').textContent = title;
        const handEl = Renderer.domElements.playerHandCards;
        handEl.innerHTML = '';
        
        const zoneArray = getZoneReference('player', zoneName);
        if (!zoneArray) return;
        
        zoneArray.forEach(card => {
            const cardEl = Renderer.createCardDOM(card, zoneName);
            cardEl.classList.add('resource-card-view');
            if (card.tapped) cardEl.classList.add('tapped');
            handEl.appendChild(cardEl);
        });
    },

    /**
     * 1枚のカードのDOMを生成する
     */
    createCardDOM: (card, zone) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        cardEl.dataset.instanceId = card.instanceId;
        cardEl.dataset.zone = zone;
        cardEl.dataset.owner = card.originalOwner;
        cardEl.style.backgroundImage = `url(${card.image || 'https://placehold.co/72x100/333/ccc?text=NoImg'})`;
        cardEl.style.borderColor = card.color === 'Red' ? '#c0392b' : card.color === 'Blue' ? '#2980b9' : card.color === 'Green' ? '#27ae60' : '#555';

        const costEl = document.createElement('div');
        costEl.className = 'card-cost';
        costEl.textContent = (typeof card.cost === 'number') ? card.cost : (card.cost?.amount || 0);
        cardEl.appendChild(costEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'card-name';
        nameEl.textContent = card.name;
        cardEl.appendChild(nameEl);

        const abilityText = card.ability?.text || card.ability?.activated?.text || card.ability?.passive?.text;
        if (abilityText) {
            const abilityEl = document.createElement('div');
            abilityEl.className = 'card-ability-text';
            abilityEl.textContent = abilityText;
            cardEl.appendChild(abilityEl);
        }
        
        if (card.type === 'Monster') {
            const gemEl = document.createElement('div');
            gemEl.className = 'gem-count';
            gemEl.textContent = card.attachedGems?.length || 0;
            cardEl.appendChild(gemEl);
        }

        // --- ★ UI状態クラスの適用 ---
        const uiState = Renderer.uiState;
        if (uiState.selectedCard === card.instanceId || uiState.selectedAttacker === card.instanceId) cardEl.classList.add('selected');
        if (zone === 'field' && card.canAttack && !card.abilityLocked) cardEl.classList.add('can-attack');
        if (uiState.selectedAttacker === card.instanceId) cardEl.classList.add('is-attacker');
        if (uiState.targeting.active && uiState.targeting.validTargets.includes(card.instanceId)) cardEl.classList.add('valid-target');
        if (card.abilityLocked) cardEl.classList.add('ability-locked');
        // (※ is-chaining は gameState.chainStack を見て判断するロジックが必要)

        // --- ★ イベントリスナーをカードDOMに直接設定 ---
        cardEl.addEventListener('click', (e) => {
            e.stopPropagation(); 
            Renderer.onCardClick(e, card);
        });

        return cardEl;
    },

    /**
     * ログを1行追加する
     */
    addLog: (message) => {
        if (!Renderer.domElements.log) return;
        const msgEl = document.createElement('div');
        msgEl.textContent = message;
        Renderer.domElements.log.prepend(msgEl);
    },
    
    hideModal: () => {
        Renderer.domElements.modalContainer.innerHTML = '';
        Renderer.domElements.modalContainer.classList.add('hidden');
    },

    showModal: (contentHtml, onBgClick = null) => {
        Renderer.domElements.modalContainer.classList.remove('hidden');
        Renderer.domElements.modalContainer.innerHTML = contentHtml;
        
        const modalBg = Renderer.domElements.modalContainer.querySelector('.modal');
        if (modalBg) {
            modalBg.addEventListener('click', (e) => {
                if (e.target === modalBg) {
                    if (onBgClick) onBgClick();
                    Renderer.hideModal();
                }
            });
        }
    },
    
    /**
     * カードクリック時の処理 (v28)
     */
    onCardClick: (e, card) => {
        const { instanceId, originalOwner, zone } = card;
        const uiState = Renderer.uiState;
        
        // 0. ターゲティング中か？
        if (uiState.targeting.active) {
            if (uiState.targeting.validTargets.includes(instanceId)) {
                // ★ エンジン呼び出し: ターゲット決定
                console.log(`[Renderer] ターゲット決定: ${card.name}`);
                // (※ Arbiter に宣言を放送するロジック)
                EventBus.broadcast('ACTION_DECLARED', {
                    action: { ...uiState.targeting.action, targetInstanceId: instanceId },
                    origin: 'PLAYER'
                });
                uiState.targeting.active = false;
            } else {
                Renderer.addLog("無効なターゲットです。");
                uiState.targeting.active = false;
            }
            Renderer.renderAll(gameState);
            return;
        }

        // 1. 相手のカードか？
        if (originalOwner === 'opponent') {
            if (zone === 'field' && uiState.selectedAttacker) {
                // ★ エンジン呼び出し: 攻撃宣言
                const attackerCard = findCard(uiState.selectedAttacker)?.card;
                if (attackerCard) {
                    console.log(`[Renderer] 攻撃宣言: ${attackerCard.name} -> ${card.name}`);
                    EventBus.broadcast('ACTION_DECLARED', {
                        action: {
                            card: attackerCard,
                            owner: 'player',
                            ability: { type: 'attack', text: '攻撃' },
                            cardInstanceId: attackerCard.instanceId,
                            targetInstanceId: instanceId
                        },
                        origin: 'PLAYER'
                    });
                }
                uiState.selectedAttacker = null;
            } else {
                Renderer.addLog("相手のカードです。");
            }
            Renderer.renderAll(gameState);
            return;
        }

        // 2. 自分のカードがクリックされた
        const currentTime = new Date().getTime();
        // 2a. ダブルクリック判定 (能力起動)
        if (currentTime - uiState.lastClick.time < 300 && uiState.lastClick.cardInstanceId === instanceId) {
            if (zone === 'field' && card.ability?.activated) {
                // ★ エンジン呼び出し: 能力起動宣言
                console.log(`[Renderer] 能力起動: ${card.name}`);
                EventBus.broadcast('ACTION_DECLARED', {
                    action: {
                        card: card,
                        owner: 'player',
                        ability: card.ability.activated,
                        cardInstanceId: instanceId
                    },
                    origin: 'PLAYER'
                });
            }
            uiState.lastClick = { time: 0, cardInstanceId: null };
            return; // (※ renderAll は Arbiter/ChainFlow 経由で呼ばれる)
        }
        uiState.lastClick = { time: currentTime, cardInstanceId: instanceId };

        // 2b. シングルクリック (選択)
        switch(zone) {
            case 'hand':
                if (uiState.selectedCard === instanceId) {
                    // ★ エンジン呼び出し: カード使用宣言
                    console.log(`[Renderer] カード使用: ${card.name}`);
                    EventBus.broadcast('ACTION_DECLARED', {
                        action: {
                            card: card,
                            owner: 'player',
                            ability: card.ability || { type: 'summon' },
                            costType: 'normal' // (※ 代替コスト選択UIが将来的に必要)
                        },
                        origin: 'PLAYER'
                    });
                    uiState.selectedCard = null;
                } else {
                    uiState.selectedCard = instanceId;
                    uiState.selectedAttacker = null;
                }
                break;
            case 'field':
                if (uiState.selectedAttacker === instanceId) {
                    // (何もしない。ダブルクリック待ち)
                } else if (card.canAttack && !card.abilityLocked) {
                    uiState.selectedAttacker = instanceId;
                    uiState.selectedCard = null;
                } else {
                    uiState.selectedAttacker = null;
                    uiState.selectedCard = null;
                    Renderer.addLog("このモンスターは行動できません。");
                }
                break;
            case 'mana':
            case 'gem':
            case 'graveyard':
                Renderer.setHandView(zone); // リソース表示に切り替え
                break;
        }
        
        Renderer.renderAll(gameState);
    },
    
    onBoardClick: (e) => {
        const targetId = e.target.id;
        if (targetId === 'player-field' || targetId === 'opponent-field' || targetId === 'game-container' || targetId === 'player-hand-container') {
            Renderer.uiState.selectedCard = null;
            Renderer.uiState.selectedAttacker = null;
            Renderer.uiState.targeting.active = false;
            if (Renderer.uiState.handView !== 'hand') {
                Renderer.setHandView('hand');
            } else {
                Renderer.renderAll(gameState);
            }
        }
    },
    
    setHandView: (view) => {
        if (Renderer.uiState.handView !== view) {
            Renderer.uiState.handView = view;
            Renderer.renderAll(gameState); 
        }
    },

    updatePhaseIndicator: (phase) => {
        const D = Renderer.domElements;
        if (!D.phaseIndicator) return;
        
        const phaseInfo = {
            'loading': { text: 'ロード中', color: 'bg-gray-500' },
            'set': { text: 'セット', color: 'bg-blue-500' },
            'main': { text: 'メイン', color: 'bg-green-500' },
            'attack': { text: 'アタック', color: 'bg-red-500' },
            'ability': { text: 'アビリティ', color: 'bg-purple-500' },
            'chain': { text: 'チェーン解決中', color: 'bg-yellow-500' },
            'stack_resolution': { text: 'スタック解決中', color: 'bg-yellow-600' },
            'end': { text: 'ゲーム終了', color: 'bg-gray-800' }
        };
        const info = phaseInfo[phase] || { text: phase, color: 'bg-gray-700' };
        D.phaseIndicator.textContent = info.text;
        D.phaseIndicator.className = `phase-indicator ${info.color}`;
    },
    
    updatePriorityAction: (gameState) => {
        // (※ 優先権ボタンの表示を更新するロジック)
        const D = Renderer.domElements;
        let action = null;
        let text = '';

        if (gameState.isChainResolving && gameState.chainStack.length > 0) {
            action = 'show_chain';
            text = `チェーン (${gameState.chainStack.length})`;
        } else if (gameState.phase === 'stack_resolution' && (gameState.stackPool.player.length > 0 || gameState.stackPool.opponent.length > 0)) {
            action = 'show_stack';
            text = `スタック (${gameState.stackPool.player.length + gameState.stackPool.opponent.length})`;
        }

        if (action) {
            D.priorityActionButton.classList.remove('hidden');
            D.priorityActionButton.dataset.action = action;
            D.priorityActionButton.textContent = text;
        } else {
            D.priorityActionButton.classList.add('hidden');
        }
    },
    
    showChainModal: () => {
        // (※ gameState.chainStack を見てモーダルを生成)
        let content = '<h3>チェーン解決中</h3>';
        // ...
        Renderer.showModal(`<div class="modal"><div class="modal-content">${content}</div></div>`);
    },
    
    showStackModal: () => {
        // (※ gameState.stackPool を見てモーダルを生成)
        // (※ ここで useStackedEffect(owner, id) を呼ぶボタンを生成する)
        let content = '<h3>スタック解決</h3>';
        // ...
        Renderer.showModal(`<div class="modal"><div class="modal-content">${content}</div></div>`);
    }
};