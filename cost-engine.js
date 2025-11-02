// cost-engine.js

import { gameState } from './main.js';
// (※ utils.js のインポート順を修正。main.js より先に gameState を使う関数を import しない)
import { getZoneReference, findCard, moveToZone } from './utils.js';
import { resolveEffects } from './effect-engine.js'; // ★ 代替コストの「追加効果」実行のため

// -----------------------------------------------------------------
// ★ コスト短縮形の「翻訳」エンジン (v28)
// -----------------------------------------------------------------

/**
 * CARD_DATA のコスト定義 (短縮形含む) を
 * 究極の汎用エンジン (payGenericCostUnified) が解釈できる
 * 完全な「カード移動」定義に変換する。
 * @param {number|string|object|Array} costDefinition - CARD_DATA の cost: ... の値
 * @returns {Array<object> | null} - 汎用「カード移動」定義の配列
 */
function resolveCostShorthand(costDefinition) {
    if (!costDefinition) return []; // コストなし

    // --- 文字列による短縮形の処理 ---
    if (typeof costDefinition === 'string') {
        let destZone = 'graveyard'; 
        let destPosition = 'top';
        let amount = 1; 
        let sourceZone = 'attachedGems';
        let filter = { type: 'gem' };

        switch (costDefinition) {
            case 'mana': // ジェム→マナ
                destZone = 'mana';
                break;
            case 'graveyard': // ジェム→墓地
                destZone = 'graveyard';
                break;
            case 'unused': // ジェム→未使用
                destZone = 'gem';
                break;
            case 'deck_bottom': // ジェム→山札下
                destZone = 'deck';
                destPosition = 'bottom';
                break;
            case 'hand': // ジェム→手札
                destZone = 'hand';
                break;
            default:
                console.error("Unknown string cost definition:", costDefinition);
                return null; 
        }
        
        return [{
            amount: amount,
            filter: filter, 
            source: { zone: sourceZone, owner: 'self' },
            destination: { zone: destZone, owner: 'self', position: destPosition } 
        }];
    }

    // --- 数値による短縮形 (マナタップ) ---
    if (typeof costDefinition === 'number') {
        if (costDefinition === 0) return [];
        return [{
            amount: costDefinition,
            filter: { state: 'untapped' }, // タップされてないもの
            source: { zone: 'mana', owner: 'self' }, // 自分のマナから
            destination: { state: 'tapped' } // 状態を「タップ」に
        }];
    }

    // --- オブジェクトまたは配列による定義 ---
    const costArray = Array.isArray(costDefinition) ? costDefinition : [costDefinition];
    
    // (※ 将来的に、 { type: 'gem', destination: 'unused' } のような
    //    オブジェクト短縮形もここで完全定義に変換する)
    
    return costArray.map(cost => {
        // (※ 現状は、オブジェクトの場合は既に完全定義であると仮定)
        return cost; 
    });
}

// -----------------------------------------------------------------
// ★ 汎用コスト支払いエンジン
// -----------------------------------------------------------------

/**
 * 究極の汎用コスト支払いエンジン
 * @param {string} owner
 * @param {Array} costsToPay - 「翻訳済み」の完全定義配列
 * @param {object} [sourceCardInfo] - 能力コストの場合の発生源モンスター { card, owner, zone }
 * @returns {boolean} - 支払い成功/失敗
 */
function payGenericCostUnified(owner, costsToPay, sourceCardInfo = null) {
    if (!costsToPay || costsToPay.length === 0) return true;

    const playerState = gameState[owner];

    // 1. 支払い計画を作成（支払えるか事前チェック）
    const paymentPlan = [];
    for (const cost of costsToPay) {
        const eligibleCards = findEligibleCostCards(owner, cost.source, cost.filter, cost.amount, sourceCardInfo);
        
        if (!eligibleCards || eligibleCards.length < cost.amount) {
            console.warn("コストが足りません:", cost);
            return false; // 支払えない
        }
        paymentPlan.push({ costDefinition: cost, cardsToMove: eligibleCards });
    }

    // 2. 支払い計画を実行
    for (const step of paymentPlan) {
        const { costDefinition: cost, cardsToMove } = step;
        const destPlayer = cost.destination.owner === 'self' ? owner : (owner === 'player' ? 'opponent' : 'player');
        
        const cardsToPayWith = cardsToMove.slice(0, cost.amount);

        cardsToPayWith.forEach(card => {
            if (cost.destination.state && !cost.destination.zone) {
                // --- 状態変更 (例: マナをタップ) ---
                if (cost.destination.state === 'tapped') {
                    card.tapped = true;
                }
            } else {
                // --- ゾーン移動 (例: ジェムを未使用ゾーンへ) ---
                moveToZone(
                    card.instanceId,
                    cost.destination.zone,
                    destPlayer,
                    cost.destination.position || 'top'
                );
            }
        });
    }
    
    console.log(`[CostEngine] ${owner} がコスト ${costsToPay.length} 項目を支払いました。`);
    return true; // 支払い成功
}

/**
 * 支払いに使用できるリソース（カード）を探すヘルパー
 */
function findEligibleCostCards(owner, source, filter, amount, sourceCardInfo = null) {
    const sourceZoneName = source.zone;
    let sourceArray = [];

    if (sourceZoneName === 'attachedGems') {
        if (sourceCardInfo && sourceCardInfo.card && sourceCardInfo.card.attachedGems) {
            sourceArray = sourceCardInfo.card.attachedGems;
        }
    } else {
        sourceArray = getZoneReference(owner, sourceZoneName);
    }
    if (!sourceArray) return [];

    // フィルターを適用
    return sourceArray.filter(card => {
        if (filter.state === 'untapped' && card.tapped) return false;
        if (filter.type === 'gem' && card.type !== 'Gem') return false; // (※ 本物の type で判定)
        return true;
    });
}

// -----------------------------------------------------------------
// ★ コア・フローからの「ラッパー」関数
// -----------------------------------------------------------------

/**
 * カードをプレイするためのコストオプションを取得する (汎用化)
 */
export function getAvailableCostOptions(card, owner) {
    const options = [];
    
    // 1. 通常コストをチェック
    const normalCostDefinition = resolveCostShorthand(card.cost);
    if (canPayGenericCost(owner, normalCostDefinition)) {
        options.push('normal');
    }

    // 2. 代替コストをチェック
    if (card.alternateCost) {
        const altCostPayment = resolveCostShorthand(card.alternateCost.payment);
        if (checkGenericConditions(owner, card.alternateCost.condition) &&
            canPayGenericCost(owner, altCostPayment)) {
            options.push('alternate');
        }
    }
    
    return options;
}

/**
 * カードプレイのコストを支払う (汎用化)
 */
export function payCostForPlay(action) {
    const { owner, card, costType } = action;
    
    if (costType === 'alternate' && card.alternateCost) {
        // 1. 追加効果を実行 (墓地から回収など)
        resolveEffects(card.alternateCost.additionalEffects, action);
        
        // 2. コスト本体を支払う (翻訳 -> 実行)
        const paymentDefinition = resolveCostShorthand(card.alternateCost.payment);
        if (!payGenericCostUnified(owner, paymentDefinition)) {
            console.warn('代替コストの支払いに失敗しました。');
            return false;
        }
        return true;
        
    } else {
        // ★ 通常コストの支払い
        const finalCostAmount = getFinalCost(action); 
        const paymentDefinition = resolveCostShorthand(finalCostAmount);
        if (!payGenericCostUnified(owner, paymentDefinition)) {
             console.warn(`通常コスト（${finalCostAmount}）の支払いに失敗しました。`);
             return false;
        }
        return true;
    }
}

/**
 * モンスター能力のコストを支払う (汎用化)
 */
export function payAbilityCost(action) {
    const { cardInstanceId, owner, ability, card, originalZone, isTrigger } = action;

    if (isTrigger || originalZone === 'stack') return true; 

    if (ability && ability.cost) { 
        const sourceCardInfo = findCard(cardInstanceId);
        if (!sourceCardInfo) return false;
        
        const paymentDefinition = resolveCostShorthand(ability.cost);
        if (!payGenericCostUnified(owner, paymentDefinition, sourceCardInfo)) {
            console.warn(`能力コスト（${ability.cost}）の支払いに失敗しました。`);
            return false;
        }
        return true;
    }
    
    return true; // コストが定義されていない能力
}

/**
 * 汎用ヘルパー: コストが支払えるか (canPay)
 */
function canPayGenericCost(owner, costsToPay) {
    if (!costsToPay || costsToPay.length === 0) return true;
    for (const cost of costsToPay) {
        const eligibleCards = findEligibleCostCards(owner, cost.source, cost.filter, cost.amount, null);
        if (!eligibleCards || eligibleCards.length < cost.amount) {
            return false;
        }
    }
    return true;
}

/**
 * 汎用ヘルパー: 代替コストの追加条件をチェック
 */
function checkGenericConditions(owner, conditions) {
    if (!conditions) return true;
    const playerState = gameState[owner];
    return conditions.every(cond => {
        switch (cond.type) {
            case 'cards_in_graveyard':
                const graveyardCardKeys = new Set(playerState.graveyard.map(c => c.cardKey));
                return cond.keys.every(reqKey => graveyardCardKeys.has(reqKey));
            default: return false;
        }
    });
}

/**
 * 最終的なマナコストを計算する (v24継続効果を考慮)
 */
function getFinalCost(action) {
    const { card, owner, ability } = action;
    let finalCost = (typeof card.cost === 'number') ? card.cost : (card.cost.amount || 0); // (※短縮形を考慮)
    const isSummoning = ability && ability.type === 'summon';

    if (isSummoning) {
        // ★ v24: gameState.continuousEffects をチェック
        for (const effect of gameState.continuousEffects) {
            if (effect.owner === owner && 
                effect.modification?.type === 'MODIFY_COST' &&
                effect.modification?.filter === 'SUMMON') 
            {
                // ★ v24: フローごとの使用制限をチェック
                const flowLimit = effect.limitPerFlow || 1;
                const usedInFlow = gameState.currentChainFlowUsedConsts.get(effect.instanceId) || 0;
                
                if (flowLimit === 'none' || usedInFlow < flowLimit) {
                    finalCost += effect.modification.amount;
                    // (※「使ったことにする」処理は、ここでは行わない。
                    //    これは「計算」であり、「支払い」ではないため。
                    //    コスト軽減効果は 'const' ではなく、常時発動型(modification)として扱う)
                }
            }
        }
    }
    
    const colorCount = card.color.split(',').length;
    return Math.max(finalCost, colorCount, 0);
}