// card-data.js

// (※ 将来的に、condition関数が gameState を参照するためにインポートが必要)
// import { gameState } from './main.js';

// -----------------------------------------------------------------
// ★ 継続効果（ステータス）の「定義」
// -----------------------------------------------------------------
// ADD_EFFECT によって gameState.continuousEffects 配列に追加される
// 再利用可能な「継続効果オブジェクト」の定義。
// (※ これらは「中間関数」によって、triggerを持つインスタンスに変換される)

/**
 * バトル・ソルジャーの「オン状態」の効果定義 (v28)
 * 召喚コスト-1。「始点」と「終点」を持つ。
 */
const BATTLE_SOLDIER_EFFECT_DEF = {
    id: 'battle_soldier_effect',
    effectKey: 'battle_soldier_effect',
    
    // ★「オン状態」の時の本体効果
    modification: { type: 'MODIFY_COST', filter: 'SUMMON', amount: -1 },
    
    // ★「始点」の定義
    resetsOn: { 
        condition: { event: 'START_STEP', step: 'turn', owner: 'self' },
        // ★ v24ルール: フローごと1回
        limitPerFlow: 1,
        totalUseLimit: 'none' // 始点自体は何度でも発動
    },
    
    // ★「終点」の定義
    expiresOn: [
        { 
            condition: { event: 'END_STEP', step: 'turn', owner: 'self' }
        },
        { 
            condition: { event: 'CARD_SUMMONED', owner: 'self' }
        }
    ]
};

/**
 * オメガバードの「攻撃後」トリガー定義 (v28)
 * 「反応」('reactsOn')し、「攻撃権回復」をプールに送る。
 * 「終点」('expiresOn')を持つ。
 */
const OMEGA_BIRD_TRIGGER_DEF = {
    id: 'omega_bird_trigger',
    effectKey: 'omega_bird_trigger',
    
    // ★「反応」の定義 (poolトリガー)
    reactsOn: { 
        type: 'pool', // ★ プール行き
        condition: { event: 'AFTER_ATTACK', source: 'self' },
        action: {
            effects: [ { type: 'recover_attack_right', target: 'self' } ]
        },
        // ★ v24ルール: 合計1回 & フローごと1回
        totalUseLimit: 1, 
        limitPerFlow: 1
    },
    
    // ★「終点」の定義
    expiresOn: { 
        condition: { event: 'END_STEP', step: 'turn', owner: 'self' }
    }
};


// -----------------------------------------------------------------
// ★ カードデータベース本体 ★
// -----------------------------------------------------------------

export const CARD_DATA = {

    // === バトル・ソルジャー (v28) ===
    'battle_soldier': { 
        name: 'バトル・ソルジャー', type: 'Monster', color: 'Red', cost: 2, 
        ability: { 
            activated: { 
                cost: 'unused', // ★ 短縮形
                effects: [
                    // ★ 汎用効果: 中間関数がこれを解釈する
                    { type: 'ADD_EFFECT', effectToAdd: () => BATTLE_SOLDIER_EFFECT_DEF }
                ],
                text: 'ジェム1つを未使用に戻す: 次の自分のターンの最初の召喚コスト-1' 
            } 
        }, 
        image: 'https://placehold.co/72x100/c0392b/ffffff?text=Battle' 
    },

    // === 聖域 (v28) ===
    'sanctuary': { 
        name: '聖域', type: 'Spell', color: 'White', cost: 7, 
        ability: { 
            effects: [
                { type: 'clear_chain_stack' },
                { type: 'clear_stack_pool', target: 'all' },
                { type: 'clear_continuous_effects', target: 'all' }
            ],
            text: '全ての宣言を無効化し、全ての継続効果を無効化する。'
        }, 
        trigger: [ // ★ カード自身が持つトリガー
            { 
                type: 'chain', 
                condition: { 
                    event: 'ACTION_DECLARED',
                    condition: (gameState, eventData) => { 
                        return gameState.chainOriginType === 'PLAYER'; // 裁定者の裁定を見る
                    }
                },
                action: { 
                    effects: [
                        { type: 'clear_chain_stack' },
                        { type: 'clear_stack_pool', target: 'all' },
                        { type: 'clear_continuous_effects', target: 'all' }
                    ]
                },
                // ★ v24ルール
                totalUseLimit: 'none', 
                limitPerFlow: 1         
            }
        ], 
        image: 'https://placehold.co/72x100/f0f0f0/000000?text=Sanctuary' 
    },

    // === ヤヒコ (v28) ===
    'yahiko': { 
        name: '追撃兵ヤヒコ', type: 'Monster', color: 'Red', cost: 2, 
        ability: { 
            activated: { 
                cost: 'unused', // ★ 短縮形
                effects: [
                    { type: 'reallocate_gem', target: 'own_monster', count: 1 } 
                ],
                text: 'ジェム1つを未使用に戻す: 味方1体に未使用ジェム1つを移動' 
            } 
        }, 
        image: 'https://placehold.co/72x100/802a2a/ffffff?text=Yahiko' 
    },

    // === ラキエル (v28) ===
    'rakiel': { 
        name: '三天の使徒ラキエル', type: 'Monster', color: 'Red,Blue,Green', 
        cost: 8, // ★ 短縮形
        alternateCost: { 
            condition: [
                { type: 'cards_in_graveyard', keys: ['reversal_arrow', 'inhibiting_wings', 'purifying_ring'] } 
            ],
            payment: 6, // ★ 短縮形
            additionalEffects: [
                { type: 'move_cards', filter: { keys: ['reversal_arrow', 'inhibiting_wings', 'purifying_ring'] }, source: { zone: 'graveyard', owner: 'self' }, destination: { zone: 'hand', owner: 'self' } }
            ]
        },
        ability: { 
            activated: { 
                cost: 'deck_bottom', // ★ 短縮形
                effects: [
                    { type: 'destroy_gem', target: 'ability_target', count: 1 },  
                    { type: 'discard', target: 'opponent', count: 1 },        
                    { type: 'destroy_mana', target: 'opponent', count: 1 }     
                ],
                text: 'ジェム1を山札の下へ: 敵モンスターのジェム1つと、敵の手札とマナを各1つ破壊' 
            } 
        }, 
        image: 'https://placehold.co/72x100/705a90/ffffff?text=Rakiel' 
    },
    
    // === オメガバード (v28) ===
    'omega_bird': { 
        name: '神炎鳥オメガバード', type: 'Monster', color: 'Red,Blue', 
        cost: 3, 
        ability: { 
            passive: { type: 'haste', text: '【速攻】' }, 
            activated: { 
                cost: 'graveyard', // ★ 短縮形
                effects: [
                    { type: 'ADD_EFFECT', effectToAdd: () => OMEGA_BIRD_TRIGGER_DEF },
                    { type: 'attach_gem_from_unused', target: 'self', amount: 1 }
                ],
                text: 'ジェム1(アビリティ): 未使用ジェムを1つ付け、「このモンスターが攻撃した後」に誘発する[回復効果]を得る。...' 
            } 
        }, 
        image: 'https://placehold.co/72x100/701a70/ffffff?text=Omega' 
    },

    // --- (以下、他のカードもv28フォーマットに変換が必要) ---
    // (※ 元のコードの簡略版データを配置)
    
    'reversal_arrow': { name: '反転の矢', type: 'Spell', color: 'Blue', cost: 7, 
        ability: { effects: [{ type: 'steal_from_hand',target: 'opponent' }] }, 
        trigger: [ { type: 'chain', condition: { event: 'PLAY_CARD', filter: { type: 'Spell' }, owner: 'opponent' }, action: { effects: [{ type: 'steal_from_hand', target:'opponent' }] }, limitPerFlow: 1 } ], 
        image: 'https://placehold.co/72x100/3a3aa0/ffffff?text=Arrow' 
    },
    'gouka': { name: '劫火', type: 'Spell', color: 'Red', cost: 7, 
        ability: { effects: [{ type: 'destroy_all_unused_gems', target: 'opponent' }] }, 
        image: 'https://placehold.co/72x100/c0392b/ffffff?text=Gouka' 
    },
    'ars': { name: '突撃兵アルス', type: 'Monster', color: 'Red', cost: 1, 
        ability: null, 
        image: 'https://placehold.co/72x100/701a1a/ffffff?text=Ars' 
    },
    'wail': { name: '号哭', type: 'Spell', color: 'Red', cost: 4, 
        ability: { effects: [{ type: 'destroy_gem', target: 'opponent_monster', count: 1 }] }, 
        image: 'https://placehold.co/72x100/902a2a/ffffff?text=Wail' 
    },
    'fire_knight': { name: '炎の騎士', type: 'Monster', color: 'Red', cost: 3, 
        ability: null, 
        image: 'https://placehold.co/72x100/a03a3a/ffffff?text=Knight' 
    },
    'lapis_dragon': { name: 'ラピスラズリドラゴン', type: 'Monster', color: 'Blue', cost: 7, 
        ability: { activated: { cost: 2, effects: [{ type: 'bounce_monster', target: 'opponent_monster' }] } }, 
        image: 'https://placehold.co/72x100/1a1a70/ffffff?text=Lapis' 
    },
    'ripple': { name: 'さざ波', type: 'Spell', color: 'Blue', cost: 2, 
        ability: { effects: [{ type: 'discard', target: 'opponent', count: 1 }] }, 
        image: 'https://placehold.co/72x100/2a2a80/ffffff?text=Ripple' 
    },
    'wave_charge': { name: 'ウェーブ・チャージ', type: 'Spell', color: 'Blue', cost: 3, 
        ability: { effects: [{ type: 'discard_and_draw', target: 'opponent', count: 1 }] }, 
        image: 'https://placehold.co/72x100/3a3a90/ffffff?text=Wave' 
    },
    'deep_soldier': { name: 'ソルジャー・ディープ', type: 'Monster', color: 'Blue', cost: 2, 
        ability: null, 
        image: 'https://placehold.co/72x100/4a4aa0/ffffff?text=Deep' 
    },
    'energy_plus': { name: 'エナジープラス', type: 'Spell', color: 'Green', cost: 2, 
        ability: { effects: [{ type: 'boost_mana', count: 1 }] }, 
        image: 'https://placehold.co/72x100/1a701a/ffffff?text=Energy' 
    },
    'forest_giant': { name: '森の巨人', type: 'Monster', color: 'Green', cost: 5, 
        ability: null, 
        image: 'https://placehold.co/72x100/2a802a/ffffff?text=Giant' 
    },
    'elf_archer': { name: 'エルフの射手', type: 'Monster', color: 'Green', cost: 3, 
        ability: null, 
        image: 'https://placehold.co/72x100/3a903a/ffffff?text=Archer' 
    },
    'rispel': { name: '青海竜リスペル', type: 'Monster', color: 'Blue', cost: 4, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'recover_spell', target: 'own_graveyard_spell' }] } }, 
        image: 'https://placehold.co/72x100/3a3a90/ffffff?text=Rispel' 
    },
    'jack_dragon': { name: 'アクアマリン・ジャックドラゴン', type: 'Monster', color: 'Blue', cost: 9, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'discard', target: 'opponent', count: 2 }] } }, 
        image: 'https://placehold.co/72x100/1a1a70/ffffff?text=Jack' 
    },
    'elemental_junk': { name: 'エレメンタル・ジャンク', type: 'Monster', color: 'Green', cost: 2, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'ramp_activated', count: 1 }] } }, 
        image: 'https://placehold.co/72x100/2a802a/ffffff?text=Junk' 
    },
    'alpha_bird': { name: 'アルファバード', type: 'Monster', color: 'Red', cost: 2, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'cleanse_effects' }] } }, 
        image: 'https://placehold.co/72x100/d04a4a/ffffff?text=Alpha' 
    },
    'beta_bird': { name: 'ベータ・バード', type: 'Monster', color: 'Red', cost: 3, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'spell_lock' }] } }, 
        image: 'https://placehold.co/72x100/b03a3a/ffffff?text=Beta' 
    },
    'gamma_bird': { name: 'ガンマ・バード', type: 'Monster', color: 'Red', cost: 3, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'gem_attach_lock' }] } }, 
        image: 'https://placehold.co/72x100/e06a6a/ffffff?text=Gamma' 
    },
    'raina': { name: '砲撃兵ライナ', type: 'Monster', color: 'Red', cost: 2, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'player_damage', amount: 1 }] } }, 
        image: 'https://placehold.co/72x100/992d2d/ffffff?text=Raina' 
    },
    'cataclysm': { name: '荒野と号哭の災禍', type: 'Spell', color: 'Green,Red', cost: 5, 
        ability: { effects: [{ type: 'destroy_mana_and_gem', target: 'opponent_monster' }] }, 
        image: 'https://placehold.co/72x100/5a5a1a/ffffff?text=Cataclysm' 
    },
    'inhibiting_wings': { name: '抑制の翼', type: 'Spell', color: 'Red', cost: 7, 
        ability: { effects: [{ type: 'destroy_all_gems', target: 'opponent_monster' }] }, 
        trigger: [ { type: 'chain', condition: { event: 'ABILITY_DECLARED', filter: { type: 'Monster' }, owner: 'opponent' }, action: { effects: [{ type: 'destroy_all_gems', target: 'triggering_card' }] }, limitPerFlow: 1 } ], 
        image: 'https://placehold.co/72x100/c0392b/ffffff?text=Wings' 
    },
    'nagrock': { name: '巨神兵ナーグロック', type: 'Monster', color: 'Green', cost: 9, 
        ability: { activated: { cost: 'all_gems_graveyard', effects: [{ type: 'replenish_gems', count: 5 }] } }, // (※ 'all_gems_graveyard' は短縮形)
        image: 'https://placehold.co/72x100/1a601a/ffffff?text=Nagrock' 
    },
    'purifying_ring': { name: '浄界の輪', type: 'Spell', color: 'Green', cost: 7, 
        ability: { effects: [{ type: 'destroy_mana_and_tap_all', target: 'opponent' }] }, 
        trigger: [ { type: 'chain', condition: { event: 'PLAY_CARD', owner: 'opponent', condition: (gs, data) => data.card.cost === gs.opponent.mana.length }, action: { effects: [{ type: 'destroy_mana_and_tap_all', target: 'opponent' }] }, limitPerFlow: 1 } ], 
        image: 'https://placehold.co/72x100/16a085/ffffff?text=Ring' 
    },
    'counter_signal': { name: '反撃の狼煙', type: 'Spell', color: 'Red', cost: 3, 
        ability: { effects: [{ type: 'ramp_gem_from_deck', count: 1 }] }, 
        trigger: [ { type: 'pool', condition: { event: 'PLAY_CARD', filter: { type: 'Spell' }, owner: 'opponent', costMin: 4 }, action: { effects: [{ type: 'ramp_gem_from_deck', count: 1 }] }, limitPerFlow: 1 } ], 
        image: 'https://placehold.co/72x100/d35400/ffffff?text=Signal' 
    },
    'gem_attachment': { name: 'ジェム・アタッチメント', type: 'Spell', color: 'Red', cost: 1, 
        ability: { effects: [{ type: 'attach_gem', target: 'own_monster' }] }, 
        image: 'https://placehold.co/72x100/d35400/ffffff?text=Attach' 
    },
    'counter_charge': { name: 'カウンター・チャージ', type: 'Spell', color: 'Red,Blue', cost: 3, 
        ability: { effects: [{ type: 'draw_with_bonus', count: 2, bonus_count: 1 }] }, 
        image: 'https://placehold.co/72x100/8e44ad/ffffff?text=Charge' 
    },
    'soul_plus': { name: 'ソウルプラス', type: 'Spell', color: 'Red', cost: 2, 
        ability: { effects: [{ type: 'ramp_gem_from_deck', count: 1 }] }, 
        image: 'https://placehold.co/72x100/e74c3c/ffffff?text=Soul+' 
    },
    'despair_blueprint': { name: '絶望の未来図', type: 'Spell', color: 'Blue', cost: 7, 
        ability: { effects: [{ type: 'deck_destroy', target: 'opponent_deck' }] }, 
        image: 'https://placehold.co/72x100/1a1a50/ffffff?text=Despair' 
    },
    'charge_out': { name: 'チャージアウト', type: 'Spell', color: 'Blue', cost: 2, 
        ability: { effects: [{ type: 'draw_and_discard' }] }, 
        image: 'https://placehold.co/72x100/2a2a80/ffffff?text=ChargeOut' 
    },
    'charge_wave_new': { name: 'チャージ・ウェイブ', type: 'Spell', color: 'Blue', cost: 3, 
        ability: { effects: [{ type: 'discard_and_draw', target: 'opponent', count: 1 }] }, 
        image: 'https://placehold.co/72x100/3a3a90/ffffff?text=C-Wave' 
    },
    'energy_wave': { name: 'エナジー・ウェイブ', type: 'Spell', color: 'Blue,Green', cost: 3, 
        ability: { effects: [{ type: 'ramp_and_discard', target: 'opponent' }] }, 
        image: 'https://placehold.co/72x100/1a805a/ffffff?text=E-Wave' 
    },
    'wilderness': { name: '荒野', type: 'Spell', color: 'Green', cost: 4, 
        ability: { effects: [{ type: 'destroy_mana', target: 'opponent', count: 1 }] }, 
        image: 'https://placehold.co/72x100/2a802a/ffffff?text=Wild' 
    },
    'wail_wave_cataclysm': { name: '号哭と波浪の災禍', type: 'Spell', color: 'Red,Blue', cost: 5, 
        ability: { effects: [{ type: 'destroy_gem_and_discard', target: 'opponent' }] }, 
        image: 'https://placehold.co/72x100/802a80/ffffff?text=WW-C' 
    },
    'wave_wilderness_cataclysm': { name: '波浪と荒野の災禍', type: 'Spell', color: 'Blue,Green', cost: 5, 
        ability: { effects: [{ type: 'discard_and_destroy_mana', target: 'opponent' }] }, 
        image: 'https://placehold.co/72x100/1a805a/ffffff?text=WW-C2' 
    },
    'ignus': { name: '戦鬼海妖イグヌス', type: 'Monster', color: 'Red,Blue', cost: 5, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'draw_and_ramp_gem_to_monster', target: 'own_monster' }] } }, 
        image: 'https://placehold.co/72x100/802a80/ffffff?text=Ignus' 
    },
    'tsunami': { name: '津波', type: 'Spell', color: 'Blue', cost: 7, 
        ability: { effects: [{ type: 'discard', target: 'opponent', count: 'all' }] }, 
        image: 'https://placehold.co/72x100/1a1a70/ffffff?text=Tsunami' 
    },
    'marc': { name: '爆撃兵マルク', type: 'Monster', color: 'Red', cost: 4, 
        ability: { 
            passive: { type: 'haste', text: '【速攻】' }, 
            activated: { cost: 'graveyard', effects: [{ type: 'prime_consolidate_gems', target: 'own_monster' }] } 
        }, 
        image: 'https://placehold.co/72x100/c04949/ffffff?text=Marc' 
    },
    'magna': { name: '迫撃兵マグナ', type: 'Monster', color: 'Red', cost: 3, 
        ability: { activated: { cost: 'graveyard', effects: [{ type: 'grant_temporary_pool_trigger_to_target', target: 'self' }] } }, 
        image: 'https://placehold.co/72x100/b02a2a/ffffff?text=Magna' 
    }
};