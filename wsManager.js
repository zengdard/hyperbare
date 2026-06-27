import Soup from 'gi://Soup'
import GLib from 'gi://GLib'

const RECONNECT_DELAY_S = 15

export class WsManager {
    constructor(callback) {
        this._callback = callback
        this._data = {}
        this._connections = new Map()
        this._displayNames = {}
        this._session = null
    }

    start(tickersByDex, displayNames) {
        this.stop()

        this._data = {}
        this._displayNames = displayNames || {}
        this._session = new Soup.Session()

        for (const [dex, tickers] of Object.entries(tickersByDex)) {
            tickers.forEach(t => {
                this._data[t] = { price: 0, pct: 0, funding: 0 }
            })
            if (tickers.length > 0) {
                this._initWS(dex, tickers)
            }
        }
    }

    stop() {
        for (const [_dex, conn] of this._connections) {
            this._closeConn(conn)
        }
        this._connections.clear()

        if (this._session) {
            try { this._session.abort() } catch (e) {}
            this._session = null
        }
        this._data = {}
        this._displayNames = {}
    }

    _closeConn(conn) {
        if (conn.reconnectId) {
            GLib.source_remove(conn.reconnectId)
            conn.reconnectId = null
        }
        if (conn.ws) {
            try {
                conn.ws.disconnectObject(this)
                conn.ws.close(0, '')
            } catch (e) {}
            conn.ws = null
        }
    }

    _scheduleReconnect(dex) {
        const conn = this._connections.get(dex)
        if (!conn) return

        if (conn.reconnectId) {
            GLib.source_remove(conn.reconnectId)
        }

        conn.reconnectId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, RECONNECT_DELAY_S, () => {
                conn.reconnectId = null
                this._initWS(dex, conn.tickers)
                return GLib.SOURCE_REMOVE
            }
        )
    }

    _initWS(dex, tickers) {
        const existing = this._connections.get(dex)
        if (existing) {
            this._closeConn(existing)
        }

        const conn = {
            ws: null,
            reconnectId: null,
            tickers: tickers,
        }
        this._connections.set(dex, conn)

        let msg = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse('wss://api.hyperliquid.xyz/ws', GLib.UriFlags.NONE),
        })

        this._session.websocket_connect_async(msg, null, null, null, null, (sess, res) => {
            try {
                conn.ws = sess.websocket_connect_finish(res)

                conn.ws.connectObject(
                    'closed', this._onWsClosed.bind(this, dex),
                    'error', this._onWsError.bind(this, dex),
                    'message', this._onWsMessage.bind(this),
                    this
                )

                conn.tickers.forEach(ticker => {
                    let subscription = { type: 'activeAssetCtx', coin: ticker }

                    if (dex !== 'default') {
                        subscription.dex = dex
                    }

                    let sub = JSON.stringify({
                        method: 'subscribe',
                        subscription: subscription,
                    })

                    try {
                        conn.ws.send_text(sub)
                    } catch (e) {}
                })
            } catch (e) {
                this._scheduleReconnect(dex)
            }
        })
    }

    _onWsClosed(dex) {
        const conn = this._connections.get(dex)
        if (conn) this._scheduleReconnect(dex)
    }

    _onWsError(dex, _ws, _error) {
        const conn = this._connections.get(dex)
        if (conn) this._scheduleReconnect(dex)
    }

    _onWsMessage(_connection, type, data) {
        if (type === Soup.WebsocketDataType.TEXT) {
            let str = new TextDecoder().decode(data.get_data())
            this._onMessage(str)
        }
    }

    _onMessage(str) {
        try {
            let json = JSON.parse(str)
            if (json.channel === 'activeAssetCtx' && json.data && json.data.ctx) {
                let coin = json.data.coin
                let ctx = json.data.ctx

                let dataKey = coin
                if (!this._data[dataKey]) {
                    if (!coin.startsWith('xyz:')) {
                        dataKey = 'xyz:' + coin
                    }
                }

                if (this._data[dataKey]) {
                    let p = parseFloat(ctx.markPx) || parseFloat(ctx.midPx) || 0
                    let prev = parseFloat(ctx.prevDayPx) || p
                    let pct = prev > 0 ? ((p - prev) / prev) * 100 : 0
                    let fundingVal = parseFloat(ctx.funding) || 0

                    this._data[dataKey] = {
                        price: p,
                        pct: pct,
                        funding: fundingVal,
                    }

                    const displayName = this._displayNames[dataKey] || dataKey
                    if (this._callback) this._callback(displayName, this._data[dataKey])
                }
            }
        } catch (e) {}
    }
}
