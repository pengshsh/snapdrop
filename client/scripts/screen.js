window.isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);

var MEDIA_CONSTRAINTS = {
    video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 }
    }
};

var ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function optimizeSdpForH264(sdp) {
    var lines = sdp.split('\r\n');
    var videoMlineIndex = -1;
    var h264Payloads = [];
    var payloadOrder = [];

    for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=video')) {
            videoMlineIndex = i;
            payloadOrder = lines[i].split(' ').slice(3);
            break;
        }
    }

    if (videoMlineIndex === -1) return sdp;

    for (var i = 0; i < lines.length; i++) {
        var match = lines[i].match(/^a=rtpmap:(\d+)\s+H264\//);
        if (match) {
            h264Payloads.push(match[1]);
        }
    }

    if (h264Payloads.length === 0) return sdp;

    var others = payloadOrder.filter(function(p) { return h264Payloads.indexOf(p) === -1; });
    var newOrder = h264Payloads.concat(others);

    lines[videoMlineIndex] = 'm=video ' + newOrder.join(' ') + ' ' + lines[videoMlineIndex].split(' ').slice(-1)[0];

    lines.splice(videoMlineIndex + 1, 0, 'b=AS:8000');

    return lines.join('\r\n');
}


function createPeerConnection() {
    return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}


class ScreenConnection {

    constructor() {
        this._listeners = {};
        this._messageQueue = [];
        this._connect();
        window.addEventListener('beforeunload', function() { this._disconnect(); }.bind(this));
        window.addEventListener('pagehide', function() { this._disconnect(); }.bind(this));
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) this._connect();
        }.bind(this));
    }

    on(type, handler) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(handler);
    }

    _emit(type, data) {
        var handlers = this._listeners[type];
        if (handlers) handlers.forEach(function(h) { h(data); });
    }

    _connect() {
        clearTimeout(this._reconnectTimer);
        if (this._isConnected() || this._isConnecting()) return;
        var protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
        var url = protocol + '://' + location.host + '/server/screen';
        var ws = new WebSocket(url);
        ws.onopen = function() {
            console.log('Screen WS: connected');
            this._flushQueue();
        }.bind(this);
        ws.onmessage = function(e) { this._onMessage(e.data); }.bind(this);
        ws.onclose = function() { this._onDisconnect(); }.bind(this);
        ws.onerror = function(e) { console.error('Screen WS error:', e); };
        this._socket = ws;
    }

    _onMessage(data) {
        var msg;
        try { msg = JSON.parse(data); } catch (e) { return; }
        console.log('Screen WS:', msg.type);
        this._emit(msg.type, msg);
    }

    send(message) {
        if (!this._isConnected()) {
            this._messageQueue.push(message);
            return;
        }
        this._socket.send(JSON.stringify(message));
    }

    _flushQueue() {
        while (this._messageQueue.length) {
            this._socket.send(JSON.stringify(this._messageQueue.shift()));
        }
    }

    _disconnect() {
        this.send({ type: 'screen-leave' });
        if (this._socket) {
            this._socket.onclose = null;
            this._socket.close();
        }
    }

    _onDisconnect() {
        console.log('Screen WS: disconnected, retry in 5s');
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(function() { this._connect(); }.bind(this), 5000);
    }

    _isConnected() {
        return this._socket && this._socket.readyState === WebSocket.OPEN;
    }

    _isConnecting() {
        return this._socket && this._socket.readyState === WebSocket.CONNECTING;
    }
}


class ScreenDisplay {

    constructor(connection) {
        this._conn = connection;
        this._pcs = {};
        this._currentCasterId = null;
        var self = this;

        connection.on('screen-created', function(msg) { self._onScreenCreated(msg); });
        connection.on('caster-joined', function(msg) { self._onCasterJoined(msg); });
        connection.on('caster-left', function(msg) { self._onCasterLeft(msg); });
        connection.on('signal', function(msg) { self._onSignal(msg); });

        connection.send({ type: 'create-screen' });
    }

    _onScreenCreated(msg) {
        document.getElementById('screenCode').textContent = msg.code;
        document.getElementById('statusText').textContent = 'Waiting for a device to connect...';
    }

    _onCasterJoined(msg) {
        if (this._currentCasterId) {
            this._cleanupCaster(this._currentCasterId);
        }
        this._currentCasterId = msg.casterId;

        if (!window.isRtcSupported) {
            document.getElementById('statusText').textContent = 'Browser does not support WebRTC';
            return;
        }

        var pc = createPeerConnection();
        var self = this;
        this._pcs[msg.casterId] = pc;

        pc.addTransceiver('video', { direction: 'recvonly' });

        pc.ontrack = function(event) {
            var video = document.getElementById('remoteVideo');
            video.srcObject = event.streams[0];
            video.style.display = 'block';
            document.getElementById('screenCodeContainer').style.display = 'none';
            document.getElementById('statusText').textContent = 'Screen is being cast...';
        };

        pc.onicecandidate = function(event) {
            if (event.candidate) {
                self._conn.send({ type: 'signal', to: msg.casterId, ice: event.candidate });
            }
        };

        pc.oniceconnectionstatechange = function() {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                self._cleanupCaster(msg.casterId);
            }
        };

        pc.createOffer()
            .then(function(offer) { return pc.setLocalDescription(offer); })
            .then(function() {
                var sdp = optimizeSdpForH264(pc.localDescription.sdp);
                pc.setLocalDescription(new RTCSessionDescription({ type: 'offer', sdp: sdp }))
                    .then(function() {
                        self._conn.send({ type: 'signal', to: msg.casterId, sdp: pc.localDescription });
                    });
            })
            .catch(function(e) { console.error('Display offer error:', e); });

        document.getElementById('statusText').textContent = 'Device connected, establishing stream...';
    }

    _onCasterLeft(msg) {
        this._cleanupCaster(msg.casterId);
    }

    _onSignal(msg) {
        var pc = this._pcs[msg.sender];
        if (!pc) return;

        if (msg.sdp) {
            pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).catch(function(e) { console.error(e); });
        } else if (msg.ice) {
            pc.addIceCandidate(new RTCIceCandidate(msg.ice)).catch(function(e) { console.error(e); });
        }
    }

    _cleanupCaster(casterId) {
        var pc = this._pcs[casterId];
        if (pc) {
            pc.close();
            delete this._pcs[casterId];
        }
        if (this._currentCasterId === casterId) {
            this._currentCasterId = null;
            var video = document.getElementById('remoteVideo');
            video.srcObject = null;
            video.style.display = 'none';
            document.getElementById('screenCodeContainer').style.display = '';
            document.getElementById('statusText').textContent = 'Caster disconnected. Waiting for a new connection...';
        }
    }
}


class ScreenCast {

    constructor(connection) {
        this._conn = connection;
        this._screenId = null;
        this._pc = null;
        this._stream = null;
        var self = this;

        connection.on('screen-joined', function(msg) { self._onScreenJoined(msg); });
        connection.on('screen-left', function() { self._onScreenLeft(); });
        connection.on('screen-error', function(msg) { self._onScreenError(msg); });
        connection.on('signal', function(msg) { self._onSignal(msg); });

        document.getElementById('shareBtn').addEventListener('click', function() { self._start(); });
        document.getElementById('stopShareBtn').addEventListener('click', function() { self._stop(); });
    }

    _start() {
        var codeInput = document.getElementById('codeInput');
        var code = codeInput.value.trim();

        if (!/^\d{6}$/.test(code)) {
            this._showError('Please enter a valid 6-digit code');
            return;
        }

        this._conn.send({ type: 'join-screen', code: code });
        document.getElementById('shareBtn').disabled = true;
        document.getElementById('shareBtn').textContent = 'Connecting...';
    }

    _onScreenJoined(msg) {
        this._screenId = msg.screenId;
        document.getElementById('statusTextCast').textContent = 'Connected! Waiting for screen share prompt...';
    }

    _onScreenError(msg) {
        this._showError(msg.message);
    }

    _onScreenLeft() {
        this._stop();
        this._showError('Screen went offline');
    }

    async _onScreenOffer(msg) {
        if (this._pc) return;
        var self = this;

        try {
            this._stream = await navigator.mediaDevices.getDisplayMedia(MEDIA_CONSTRAINTS);
        } catch (e) {
            this._showError('Screen sharing was denied or is not supported');
            this._conn.send({ type: 'screen-leave' });
            return;
        }

        this._stream.getVideoTracks()[0].onended = function() { self._stop(); };

        this._pc = createPeerConnection();

        this._stream.getTracks().forEach(function(track) {
            self._pc.addTrack(track, self._stream);
        });

        this._pc.onicecandidate = function(event) {
            if (event.candidate) {
                self._conn.send({ type: 'signal', to: self._screenId, ice: event.candidate });
            }
        };

        this._pc.oniceconnectionstatechange = function() {
            if (self._pc && (self._pc.iceConnectionState === 'disconnected' || self._pc.iceConnectionState === 'failed')) {
                self._stop();
            }
        };

        document.getElementById('shareBtn').hidden = true;
        document.getElementById('stopShareBtn').hidden = false;
        document.getElementById('codeInput').disabled = true;
        document.getElementById('statusTextCast').textContent = 'Sharing screen (1080p 30fps)...';

        try {
            await this._pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            var answer = await this._pc.createAnswer();
            await this._pc.setLocalDescription(answer);

            var optimizedSdp = optimizeSdpForH264(this._pc.localDescription.sdp);
            await this._pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp: optimizedSdp }));

            this._conn.send({ type: 'signal', to: this._screenId, sdp: this._pc.localDescription });
        } catch (e) {
            console.error('Cast answer error:', e);
            this._stop();
        }
    }

    _onSignal(msg) {
        if (msg.sdp && msg.sdp.type === 'offer') {
            this._onScreenOffer(msg);
        } else if (msg.ice && this._pc) {
            this._pc.addIceCandidate(new RTCIceCandidate(msg.ice)).catch(function(e) { console.error(e); });
        }
    }

    _stop() {
        if (this._stream) {
            this._stream.getTracks().forEach(function(t) { t.stop(); });
            this._stream = null;
        }
        if (this._pc) {
            this._pc.close();
            this._pc = null;
        }
        this._conn.send({ type: 'screen-leave' });
        this._screenId = null;

        document.getElementById('shareBtn').hidden = false;
        document.getElementById('shareBtn').disabled = false;
        document.getElementById('shareBtn').textContent = 'Share Screen';
        document.getElementById('stopShareBtn').hidden = true;
        document.getElementById('codeInput').disabled = false;
        document.getElementById('statusTextCast').textContent = '';
    }

    _showError(message) {
        document.getElementById('shareBtn').disabled = false;
        document.getElementById('shareBtn').textContent = 'Share Screen';
        document.getElementById('statusTextCast').textContent = message;
    }
}


(function init() {
    if (!window.isRtcSupported) {
        document.getElementById('statusText').textContent = 'Your browser does not support WebRTC';
        document.getElementById('statusTextCast').textContent = 'Your browser does not support WebRTC';
        document.getElementById('shareBtn').disabled = true;
        return;
    }

    var connection = new ScreenConnection();
    new ScreenDisplay(connection);
    new ScreenCast(connection);

    document.getElementById('modeToggle').addEventListener('click', function() {
        var displayMode = document.getElementById('displayMode');
        var castMode = document.getElementById('castMode');
        var toggle = document.getElementById('modeToggle');

        if (displayMode.hidden) {
            displayMode.hidden = false;
            castMode.hidden = true;
            toggle.textContent = 'Switch to Cast Mode';
        } else {
            displayMode.hidden = true;
            castMode.hidden = false;
            toggle.textContent = 'Switch to Display Mode';
        }
    });
})();
