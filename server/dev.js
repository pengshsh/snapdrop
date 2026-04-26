const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const forge = require('node-forge');

const HTTP_PORT = 8080;
const HTTPS_PORT = 4443;
const WS_TARGET = 'ws://localhost:3000';

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.webmanifest': 'application/manifest+json'
};

const CLIENT_DIR = path.join(__dirname, '..', 'client');

function serveStaticFile(req, res) {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    let filePath = path.join(CLIENT_DIR, urlPath);
    filePath = path.normalize(filePath);

    if (!filePath.startsWith(CLIENT_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            const ext = path.extname(filePath);
            if (!ext) {
                fs.readFile(path.join(CLIENT_DIR, 'index.html'), (e, d) => {
                    if (e) { res.writeHead(404); res.end('Not Found'); return; }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(d);
                });
                return;
            }
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

function generateSelfSignedCert(lanIp) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    const attrs = [
        { name: 'commonName', value: lanIp || 'localhost' },
        { name: 'organizationName', value: 'Snapdrop Dev' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    const altNames = [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' }
    ];
    if (lanIp) altNames.push({ type: 7, ip: lanIp });

    cert.setExtensions([{
        name: 'subjectAltName',
        altNames: altNames
    }, {
        name: 'basicConstraints',
        cA: false
    }, {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true
    }, {
        name: 'extKeyUsage',
        serverAuth: true
    }]);

    cert.sign(keys.privateKey, forge.md.sha256.create());

    return {
        key: forge.pki.privateKeyToPem(keys.privateKey),
        cert: forge.pki.certificateToPem(cert)
    };
}

function createWsProxy(wss, request, socket, head) {
    const proxyWs = new WebSocket(WS_TARGET + request.url);

    proxyWs.on('open', () => {
        wss.handleUpgrade(request, socket, head, (clientWs) => {
            clientWs.on('message', (data, isBinary) => {
                if (proxyWs.readyState === WebSocket.OPEN) {
                    proxyWs.send(data, { binary: isBinary });
                }
            });
            clientWs.on('close', () => {
                if (proxyWs.readyState === WebSocket.OPEN) proxyWs.close();
            });
            clientWs.on('error', () => {
                if (proxyWs.readyState === WebSocket.OPEN) proxyWs.close();
            });

            proxyWs.on('message', (data, isBinary) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(data, { binary: isBinary });
                }
            });
            proxyWs.on('close', () => {
                if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
            });
            proxyWs.on('error', () => {
                if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
            });
        });
    });

    proxyWs.on('error', () => socket.destroy());
}

const lanIp = process.argv.find(a => a.startsWith('--lan='));
const lanIpAddr = lanIp ? lanIp.split('=')[1] : null;

const httpServer = http.createServer(serveStaticFile);
const httpWss = new WebSocket.Server({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => createWsProxy(httpWss, req, socket, head));
httpServer.listen(HTTP_PORT, () => {
    console.log('  HTTP:     http://localhost:' + HTTP_PORT);
    if (lanIpAddr) console.log('            http://' + lanIpAddr + ':' + HTTP_PORT + ' (file transfer only)');
});

if (lanIpAddr) {
    const { key, cert } = generateSelfSignedCert(lanIpAddr);
    const httpsServer = https.createServer({ key, cert }, serveStaticFile);
    const httpsWss = new WebSocket.Server({ noServer: true });
    httpsServer.on('upgrade', (req, socket, head) => createWsProxy(httpsWss, req, socket, head));
    httpsServer.listen(HTTPS_PORT, () => {
        console.log('  HTTPS:    https://localhost:' + HTTPS_PORT + ' (click Advanced -> Proceed)');
        console.log('            https://' + lanIpAddr + ':' + HTTPS_PORT);
    });
}

console.log('  WS Proxy: ' + WS_TARGET);
console.log('');
console.log('  Make sure WebSocket server is running:');
console.log('  cd server && node index.js');
console.log('');

if (lanIpAddr) {
    console.log('  Other devices on LAN:');
    console.log('  - File transfer: http://' + lanIpAddr + ':' + HTTP_PORT);
    console.log('  - Screen cast:   https://' + lanIpAddr + ':' + HTTPS_PORT + '/screen.html');
    console.log('    (accept the self-signed cert warning on first visit)');
} else {
    console.log('  For LAN access, restart with --lan=YOUR_IP');
    console.log('  e.g. node dev.js --lan=192.168.123.69');
}

console.log('');
console.log('========================================');

process.on('SIGINT', () => {
    httpServer.close();
    process.exit();
});
