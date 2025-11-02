// effect-engine.js

import { gameState, endGame } from './main.js';
import { generateInstanceId, moveToZone, findCard, getZoneReference, drawCard } from './utils.js';
// (※ Renderer は addLog のためにインポートするが、将来的には EventBus 経由にすべき)
// import { Renderer } from './renderer.js';

// -----------------------------------------------------------------
// ★ メインの「効果解決」エンジン
// -----------------------------------------------------------------

/**
 * 渡された effects 配列を順に解決（実行）する
 * @param {Array<object>} effects - CARD_DATA の [effects] 配列
 * @param {object} actionContext - 
 * この解決を実行している「親」アクションの情報。
 * (例: { owner: 'player', card: (聖域), instanceId: (聖域自身のID), targetInstanceId: (対象のID) })
 */
export function resolveEffects(effects, actionContext) {
    if (!effects || effects.length === 0) return;

    for (const effect of effects) {
        // ★ 汎用的な switch 文で、基礎コンポーネントを呼び出す
        switch (effect.type) {
            
            // --- ★ v28: 継続効果の「中間関数」ロジック ---
            case 'ADD_EFFECT':
                executeAddEffect(effect, actionContext);
                break;
            case 'REMOVE_EFFECT':
                executeRemoveEffect(effect, actionContext);
                break;

            // --- ★ v24: 聖域の「大ハンマー」ロジック ---
            case 'clear_chain_stack':
                gameState.chainStack = [];
                console.log('チェーン・スタックが全て無効化された！');
                break;
            case 'clear_stack_pool':
                if (effect.target === 'all' || effect.target === 'player') gameState.stackPool.player = [];
                if (effect.target === 'all' || effect.target === 'opponent') gameState.stackPool.opponent = [];
                console.log('スタック・プールが全て無効化された！');
                break;
            case 'clear_continuous_effects':
                gameState.continuousEffects = [];
                console.log('全ての継続効果が（無効化）された！');
                break;

            // --- ★ 基礎効果コンポーネント (旧からの移植・汎用化) ---
            
            case 'PLAYER_DAMAGE': 
                executePlayerDamage(effect, actionContext);
                break;
            case 'DRAW_CARD':
                executeDrawCard(effect, actionContext);
                break;
            case 'DISCARD': 
                executeDiscard(effect, actionContext);
                break;
            case 'MOVE_CARDS': 
                executeMoveCards(effect, actionContext);
                break;
            case 'BOOST_MANA': 
                executeBoostMana(effect, actionContext);
                break;
            case 'DESTROY_GEM': 
                executeDestroyGem(effect, actionContext);
                break;
            case 'DESTROY_MANA': 
                executeDestroyMana(effect, actionContext);
                break;
            case 'DESTROY_ALL_UNUSED_GEMS': 
                executeDestroyAllUnusedGems(effect, actionContext);
                break;
            case 'BOUNCE_MONSTER': 
                executeBounceMonster(effect, actionContext);
                break;
            case 'RECOVER_ATTACK_RIGHT': 
                executeRecoverAttackRight(effect, actionContext);
                break;
                
            default:
                console.warn(`[EffectEngine] 未知の効果タイプ: ${effect.type}`, effect);
        }
    }
}


// -----------------------------------------------------------------
// ★ v28「中間関数」ロジックの実装
// -----------------------------------------------------------------

/**
 * v28: `ADD_EFFECT` を実行する (中間関数)
 */
function executeAddEffect(effect, actionContext) {
    if (!effect.effectToAdd) {
        console.error("[EffectEngine] ADD_EFFECT: `effectToAdd` が定義されていません。", effect);
        return;
    }
    
    const definition = effect.effectToAdd(actionContext.card); 
    if (!definition) return;
    
    // 1. 「始点」('resetsOn') があるか？
    if (definition.resetsOn) {
        // --- 「待ち状態」の効果を生成 ---
        const waitEffect = createEffectInstance(definition, actionContext, true);
        gameState.continuousEffects.push(waitEffect);
        console.log(`[EffectEngine] -> '待ち状態' (${waitEffect.effectKey}) を追加しました。`);

    } else {
        // --- 「オン状態」の効果を「直接」生成 ---
        const activeEffect = createEffectInstance(definition, actionContext, false);
        gameState.continuousEffects.push(activeEffect);
        console.log(`[EffectEngine] -> 'オン状態' (${activeEffect.effectKey}) を直接追加しました。`);
    }
}

/**
 * v28: `REMOVE_EFFECT` を実行する (中間関数)
 */
function executeRemoveEffect(effect, actionContext) {
    let instanceIdToRemove = null;

    if (effect.target === 'self') {
        // ★ 実行中のトリガーの「発生源」である継続効果自身を削除する
        instanceIdToRemove = actionContext.sourceEffectInstanceId; 
    } 
    // (※ 他のターゲット指定)

    if (!instanceIdToRemove) {
        console.error("[EffectEngine] REMOVE_EFFECT: 削除対象の instanceId が見つかりません。", effect, actionContext);
        return;
    }

    const index = gameState.continuousEffects.findIndex(e => e.instanceId === instanceIdToRemove);
    if (index > -1) {
        const removedEffect = gameState.continuousEffects.splice(index, 1);
        console.log(`[EffectEngine] REMOVE_EFFECT: '${removedEffect[0].effectKey}' (ID: ${instanceIdToRemove}) を削除しました。`);
    }
}


/**
 * ★ 中間関数ヘルパー ★ (v28)
 * CARD_DATA定義から「継続効果オブジェクト（インスタンス）」を生成する
 */
function createEffectInstance(definition, actionContext, isWaiting) {
    const newInstanceId = generateInstanceId();
    // (※ actionContext.card は「ADD_EFFECT」を実行するカード自身)
    const sourceCard = actionContext.card;
    
    const baseEffect = {
        id: isWaiting ? `${definition.id}_wait` : definition.id,
        effectKey: definition.effectKey,
        instanceId: newInstanceId,
        owner: actionContext.owner, 
        sourceCardInstanceId: sourceCard.instanceId, 
        
        triggers: [], 
        
        // ★ v24ルールのための初期値 (インスタンスにコピー)
        // (※ definition からコピー)
        totalUseLimit: definition.totalUseLimit || (definition.reactsOn ? 1 : 'none'),
        limitPerFlow: definition.limitPerFlow || (definition.reactsOn ? 1 : 'none'),
        currentTotalUses: 0, 
    };

    if (isWaiting) {
        // --- 「待ち状態」のトリガーを生成 ---
        baseEffect.isWaitingEffect = true;
        const conditions = Array.isArray(definition.resetsOn) ? definition.resetsOn : [definition.resetsOn];
        conditions.forEach(resets => {
            baseEffect.triggers.push({
                type: 'const',
                condition: resets.condition,
                action: {
                    effects: [
                        { type: 'ADD_EFFECT', effectToAdd: () => createEffectInstance(definition, actionContext, false) }, 
                        { type: 'REMOVE_EFFECT', target: 'self' } 
                    ]
                },
                totalUseLimit: resets.totalUseLimit || 'none', 
                limitPerFlow: resets.limitPerFlow || 'none'
            });
        });
        
    } else {
        // --- 「オン状態」のトリガーを生成 ---
        baseEffect.modification = definition.modification; // ★ 本体効果
        
        // 1. 「終点」('expiresOn') を 'const' トリガーに変換
        if (definition.expiresOn) {
            const conditions = Array.isArray(definition.expiresOn) ? definition.expiresOn : [definition.expiresOn];
            conditions.forEach(exp => {
                baseEffect.triggers.push({
                    type: 'const',
                    condition: exp.condition,
                    action: { effects: [ { type: 'REMOVE_EFFECT', target: 'self' } ] },
                    totalUseLimit: 'none', 
                    limitPerFlow: 'none'
                });
            });
        }
        // 2. 「反応」('reactsOn') をトリガーに変換
        if (definition.reactsOn) {
            const reactions = Array.isArray(definition.reactsOn) ? definition.reactsOn : [definition.reactsOn];
            reactions.forEach(react => {
                baseEffect.triggers.push({
                    type: react.type, // 'pool', 'chain', 'const'
                    condition: react.condition,
                    action: react.action,
                    totalUseLimit: react.totalUseLimit !== undefined ? react.totalUseLimit : 1, 
                    limitPerFlow: react.limitPerFlow !== undefined ? react.limitPerFlow : 1
                });
            });
        }
    }
    
    return baseEffect;
}


// -----------------------------------------------------------------
// ★ 基礎効果コンポーネント (実装例)
// -----------------------------------------------------------------

function executePlayerDamage(effect, actionContext) {
    const targetPlayerKey = (effect.target === 'opponent') ? 
        (actionContext.owner === 'player' ? 'opponent' : 'player') : 
        actionContext.owner;
    
    if (effect.condition && !effect.condition(gameState, actionContext)) return;
    
    gameState[targetPlayerKey].life -= effect.amount;
    console.log(`[EffectEngine] ${targetPlayerKey} に ${effect.amount} ダメージ！`);
    
    if (gameState[targetPlayerKey].life <= 0) {
        endGame(targetPlayerKey === 'player' ? 'opponent' : 'player');
    }
}

function executeDrawCard(effect, actionContext) {
    const targetPlayerKey = (effect.target === 'opponent') ? 
        (actionContext.owner === 'player' ? 'opponent' : 'player') : 
        actionContext.owner;
    const amount = effect.amount || 1;
    for (let i = 0; i < amount; i++) {
        drawCard(gameState[targetPlayerKey]); 
    }
    console.log(`[EffectEngine] ${targetPlayerKey} が ${amount} 枚ドロー。`);
}

function executeDiscard(effect, actionContext) {
    const targetPlayerKey = (effect.target === 'opponent') ? 
        (actionContext.owner === 'player' ? 'opponent' : 'player') : 
        actionContext.owner;
    const targetHand = getZoneReference(targetPlayerKey, 'hand');
    if (!targetHand || targetHand.length === 0) return;
    const amount = effect.count === 'all' ? targetHand.length : (effect.count || 1);
    for (let i = 0; i < amount; i++) {
        if (targetHand.length === 0) break;
        const cardToDiscard = targetHand.pop(); 
        moveToZone(cardToDiscard.instanceId, 'graveyard');
        console.log(`[EffectEngine] ${targetPlayerKey} が 「${cardToDiscard.name}」 を捨てた。`);
    }
}

function executeMoveCards(effect, actionContext) {
    // (※ 代替コストの回収ロジック)
    if (effect.source?.zone === 'graveyard' && effect.destination?.zone === 'hand') {
        const owner = actionContext.owner;
        const graveyard = getZoneReference(owner, 'graveyard');
        effect.filter.keys.forEach(key => {
            const cardIndex = graveyard.findIndex(c => c.cardKey === key);
            if (cardIndex > -1) {
                const [cardToMove] = graveyard.splice(cardIndex, 1);
                moveToZone(cardToMove.instanceId, 'hand', owner);
                console.log(`[EffectEngine] 墓地から「${cardToMove.name}」を手札に戻した。`);
            }
        });
    } else {
        console.log(`[EffectEngine] (未実装) MOVE_CARDS を実行:`, effect);
    }
}

function executeBoostMana(effect, actionContext) {
    const owner = actionContext.owner;
    const hand = getZoneReference(owner, 'hand');
    if (hand.length > 0) {
        moveToZone(hand[0].instanceId, 'mana', owner);
        console.log(`[EffectEngine] ${owner} が手札からマナをブースト。`);
    }
}

function executeDestroyGem(effect, actionContext) {
    const targetInstanceId = actionContext.targetInstanceId;
    if (!targetInstanceId) return; 
    const targetCardInfo = findCard(targetInstanceId);
    if (!targetCardInfo || targetCardInfo.zone !== 'field') return; 
    if (targetCardInfo.card.attachedGems.length > 0) {
        const gemToDestroy = targetCardInfo.card.attachedGems.pop(); 
        moveToZone(gemToDestroy.instanceId, 'graveyard');
        console.log(`[EffectEngine] ${targetCardInfo.card.name} のジェムを破壊。`);
    } else {
        const gemZone = getZoneReference(targetCardInfo.owner, 'gem');
        if (gemZone.length > 0) {
            const gemToDestroy = gemZone.pop();
            moveToZone(gemToDestroy.instanceId, 'graveyard');
            console.log(`[EffectEngine] ${targetCardInfo.owner} の未使用ジェムを破壊。`);
        }
    }
}

function executeDestroyMana(effect, actionContext) {
     const targetPlayerKey = (effect.target === 'opponent') ? 
        (actionContext.owner === 'player' ? 'opponent' : 'player') : 
        actionContext.owner;
    const manaZone = getZoneReference(targetPlayerKey, 'mana');
    if (manaZone.length > 0) {
        const manaToDestroy = manaZone.pop(); 
        moveToZone(manaToDestroy.instanceId, 'graveyard');
        console.log(`[EffectEngine] ${targetPlayerKey} のマナを1つ破壊。`);
    }
}

function executeDestroyAllUnusedGems(effect, actionContext) {
    const targetPlayerKey = (effect.target === 'opponent') ? 
        (actionContext.owner === 'player' ? 'opponent' : 'player') : 
        actionContext.owner;
    const gemZone = getZoneReference(targetPlayerKey, 'gem');
    if (gemZone.length > 0) {
        const gemsToMove = [...gemZone];
        gemsToMove.forEach(gem => moveToZone(gem.instanceId, 'graveyard'));
        console.log(`[EffectEngine] ${targetPlayerKey} の未使用ジェム ${gemsToMove.length} 個を全て破壊。`);
    }
}

function executeBounceMonster(effect, actionContext) {
    const targetInstanceId = actionContext.targetInstanceId; 
    if (!targetInstanceId) return;
    const targetCardInfo = findCard(targetInstanceId);
    if (!targetCardInfo || targetCardInfo.zone !== 'field') return;
    moveToZone(targetInstanceId, 'hand', targetCardInfo.owner);
    console.log(`[EffectEngine] ${targetCardInfo.card.name} を手札に戻した。`);
}

function executeRecoverAttackRight(effect, actionContext) {
    let targetCard = null;
    if (effect.target === 'self') {
        targetCard = actionContext.card;
    }
    if (targetCard && targetCard.type === 'Monster') {
        targetCard.canAttack = true;
        console.log(`[EffectEngine] ${targetCard.name} の攻撃権が回復した。`);
    }
}