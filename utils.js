// utils.js

// 必要なモジュール（ファイル）をインポート
// ★ main.js から gameState と endGame をインポート
import { gameState, endGame } from './main.js';
// ★ card-data.js から本物の CARD_DATA をインポート
import { CARD_DATA } from './card-data.js'; 

// --- ゾーンゲートウェイ ---

const ZONES = ['hand', 'field', 'mana', 'gem', 'graveyard', 'deck'];
const PLAYERS = ['player', 'opponent'];

/**
 * 指定されたプレイヤーとゾーン名に対応する配列への参照を返す (ゲートウェイ)
 * @param {string} owner - 'player' または 'opponent'
 * @param {string} zoneName - 'hand', 'field', 'mana', 'gem', 'graveyard', 'deck'
 * @returns {Array | null} - 対象ゾーンの配列への参照
 */
export function getZoneReference(owner, zoneName) {
    if (!PLAYERS.includes(owner)) {
        console.error("getZoneReference: 無効な owner です:", owner);
        return null;
    }
    if (!ZONES.includes(zoneName)) {
        console.error("getZoneReference: 無効な zoneName です:", zoneName);
        return null;
    }
    if (!gameState[owner] || !gameState[owner][zoneName]) {
        // (※ ゲームロード中はまだ gameState がない可能性があるので、エラーではなく null を返す)
        // console.error("getZoneReference: gameState にゾーンが見つかりません:", owner, zoneName);
        return null;
    }
    
    return gameState[owner][zoneName];
}

/**
 * ゾーンとモンスター（の付与ジェム）からカードインスタンスIDでカードを検索する
 * @param {number} cardInstanceId - 検索するカードのユニークID
 * @returns {{card: object, owner: string, zone: string, parentMonster?: object} | null} - カード情報
 */
export function findCard(cardInstanceId) {
    for (const player of PLAYERS) {
        // 1. 基本ゾーンを検索
        for (const zone of ZONES) {
            const zoneArray = getZoneReference(player, zone);
            if (!zoneArray) continue;

            const card = zoneArray.find(c => c.instanceId === cardInstanceId);
            if (card) return { card, owner: player, zone };
        }
        
        // 2. 付与ジェム (attachedGems) を検索 (フィールドのモンスターのみ)
        const field = getZoneReference(player, 'field');
        if (field) {
            for (const monster of field) {
                // (※ attachedGems は card-data.js で定義されず、インスタンスで付与される)
                if (monster.attachedGems) {
                    const gem = monster.attachedGems.find(g => g.instanceId === cardInstanceId);
                    if (gem) return { card: gem, owner: player, zone: 'attachedGems', parentMonster: monster };
                }
            }
        }
    }
    return null; // 見つからない
}

/**
 * カードをゾーン間で移動させる
 * @param {number} cardInstanceId - 移動するカードのID
 * @param {string} toZone - 移動先のゾーン名
 * @param {string} [targetPlayer=null] - 移動先のプレイヤー (指定なければ元の owner)
 * @param {string} [position='top'] - 'top' (push) or 'bottom' (unshift)
 */
export function moveToZone(cardInstanceId, toZone, targetPlayer = null, position = 'top') {
    const cardInfo = findCard(cardInstanceId);
    if (!cardInfo) {
        console.warn(`moveToZone: 移動対象のカード(ID: ${cardInstanceId}) が見つかりません。`);
        return;
    }

    const { card, owner, zone, parentMonster } = cardInfo;

    // 1. 元の場所から削除
    if (zone === 'attachedGems' && parentMonster) {
        parentMonster.attachedGems = parentMonster.attachedGems.filter(g => g.instanceId !== cardInstanceId);
    } else {
        const sourceZoneArray = getZoneReference(owner, zone);
        if (sourceZoneArray) {
            const index = sourceZoneArray.findIndex(c => c.instanceId === cardInstanceId);
            if (index > -1) {
                sourceZoneArray.splice(index, 1);
            }
        }
    }

    // 2. 移動先プレイヤーを決定
    // (墓地は常に元の持ち主の墓地へ)
    const destinationPlayer = (toZone === 'graveyard' && card.originalOwner) ?
                                card.originalOwner : (targetPlayer || owner);

    // 3. ジェムが剥がれる処理
    if (card.type === 'Monster' && card.attachedGems && card.attachedGems.length > 0 && 
        (toZone === 'hand' || toZone === 'graveyard' || toZone === 'deck')) {
        
        const gemsToMove = [...card.attachedGems];
        card.attachedGems = [];
        gemsToMove.forEach(gemCard => {
            moveToZone(gemCard.instanceId, 'graveyard'); 
        });
        // Renderer.addLog(`${card.name} のジェム ${gemsToMove.length} 個が墓地に送られた。`); // (将来)
    }

    // 4. 新しい場所に追加
    const destinationZoneArray = getZoneReference(destinationPlayer, toZone);
    if (destinationZoneArray) {
        // (※ ゾーン移動時に状態をリセット)
        card.tapped = false; 
        card.abilityLocked = false; 
        card.canAttack = false;
        // ... (他の状態リセット)

        if (toZone === 'deck' && position === 'bottom') {
            destinationZoneArray.unshift(card); // 配列の先頭に追加
        } else {
            destinationZoneArray.push(card); // 配列の末尾に追加
        }
    } else {
        console.error("moveToZone: 無効な移動先です:", destinationPlayer, toZone);
    }
}


// --- デッキ・カードユーティリティ ---

let nextInstanceId = 1;
/**
 * 衝突しないユニークIDを生成する
 */
export function generateInstanceId() { 
    return nextInstanceId++; 
}

/**
 * デッキリスト (文字列配列) から、完全なカードオブジェクトの配列を生成する
 * (※ v28中間関数モデルを考慮)
 * @param {string[]} list - カードキーの配列
 * @param {string} prefix - 'p' (player) or 'o' (opponent)
 * @returns {Array<object>} - カードインスタンスの配列
 */
export function createDeckFromList(list, prefix) {
    const counts = {};
    const owner = (prefix === 'p' ? 'player' : 'opponent');

    return list.map(cardKey => {
        // ★ 本物の CARD_DATA を参照
        const cardData = CARD_DATA[cardKey];
        if (!cardData) {
            console.error(`CARD_DATA にキーが見つかりません: ${cardKey}`);
            return { name: '不明なカード', type: 'Unknown', cost: 0, instanceId: generateInstanceId(), originalOwner: owner, attachedGems: [] };
        }
        
        counts[cardKey] = (counts[cardKey] || 0) + 1;
        
        // ★ カードデータを「ディープコピー」してインスタンス化する
        // (※ JSON.parse(JSON.stringify(cardData)) は関数をコピーできないため、
        //    v28設計の effectToAdd のような「関数」は正しくコピーされない。
        //    effect-engine 側で cardKey から CARD_DATA を再参照するのが最も安全)
        
        // (※ ここでは、カードの「状態」を持つための基本インスタンスを生成する)
        const cardInstance = {
            cardKey: cardKey, // ★ 元の定義(CARD_DATA)を参照するためのキー
            name: cardData.name,
            type: cardData.type,
            color: cardData.color,
            cost: cardData.cost, // (短縮形のまま保持)
            alternateCost: cardData.alternateCost, // (定義のまま保持)
            
            // (※ ability や trigger も、effect-engine や trigger-engine が
            //    cardKey を使って CARD_DATA を直接参照するようにする)
            // ability: cardData.ability, 
            // trigger: cardData.trigger,
            
            id: `${prefix}_${cardKey}_${counts[cardKey]}`, 
            instanceId: generateInstanceId(), 
            originalOwner: owner,
            
            // --- インスタンス固有の状態 ---
            attachedGems: [],
            canAttack: false,
            tapped: false, 
            abilityLocked: false,
            activatedAbilityUsedThisTurn: false,
            turnSummoned: -1
        };
        
        return cardInstance;
    });
}

/**
 * デッキ配列をシャッフルする (Fisher-Yates)
 */
export function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

/**
 * 指定されたプレイヤーがカードを1枚引く
 * (※ これは main.js の「手順書」の一部であり、GameFlowManagerから呼ばれる)
 */
export function drawCard(playerState) {
    if (playerState.deck.length === 0) {
        if (gameState.phase !== 'end') {
            const winner = (playerState.name === 'Player') ? 'opponent' : 'player';
            endGame(winner); // ★ main.js の endGame を呼ぶ
        }
        return;
    }
    const card = playerState.deck.pop();
    playerState.hand.push(card);
}

/**
 * ターン開始時にジェムを装着し、ジェム0のモンスターを破壊する
 * (※ これも main.js の「手順書」の一部)
 */
export function checkAndAttachGems(playerState) {
    // 1. ジェム装着
    playerState.field.forEach(monster => {
        if (monster.attachedGems.length === 0 && playerState.gem.length > 0) {
            const gemCard = playerState.gem.pop();
            monster.attachedGems.push(gemCard);
            // Renderer.addLog(`未使用ジェムが「${monster.name}」にセットされた。`); // (将来)
        }
    });

    // 2. ジェム0のモンスターを破壊
    const monstersToDestroy = playerState.field
        .filter(monster => monster.attachedGems.length === 0)
        .map(monster => monster.instanceId);
        
    monstersToDestroy.forEach(instanceId => {
        // const cardName = findCard(instanceId)?.card.name || 'モンスター';
        // Renderer.addLog(`${cardName} はジェムがなく消滅した。`); // (将来)
        moveToZone(instanceId, 'graveyard'); 
    });
}
