// event-bus.js

/**
 * ゲーム内イベントの「放送局」。
 * 疎結合アーキテクチャの核となる Pub/Sub システム。
 */
export const EventBus = {
    listeners: {},

    /**
     * イベントを「購読（Subscribe）」する
     * @param {string} eventName - 'START_STEP', 'ACTION_DECLARED' など
     * @param {Function} listener - 呼び出してほしい関数 (コールバック)
     */
    subscribe: function(eventName, listener) {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(listener);
        // console.log(`[EventBus] SUBSCRIBED: ${listener.name || 'Anonymous'} to ${eventName}`);
    },

    /**
     * イベントを「放送（Broadcast）」する
     * @param {string} eventName - 'START_STEP' など
     * @param {object} eventData - イベントに関するデータオブジェクト
     */
    broadcast: function(eventName, eventData) {
        // console.log(`[EventBus] BROADCAST: ${eventName}`, eventData);
        if (!this.listeners[eventName]) {
            return; // 誰も聞いていなければ何もしない
        }
        
        // そのイベントを聞いている「全員」に通知する
        this.listeners[eventName].forEach(listener => {
            try {
                // イベントデータに、どのイベントが起きたかを（念のため）含める
                const dataWithEvent = { ...eventData, eventName: eventName };
                listener(dataWithEvent);
            } catch (error) {
                console.error(`[EventBus] Error in listener for event ${eventName}:`, error, listener.name, eventData);
            }
        });
    }
};