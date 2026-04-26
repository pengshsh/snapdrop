# Local Development

## Docker Setup (Recommended for LAN Usage)

First, [Install docker with docker-compose](https://docs.docker.com/compose/install/).

Then, clone the repository:
```
    git clone https://github.com/RobinLinus/snapdrop.git
    cd snapdrop
```

### Configure your LAN IP

Edit `docker/fqdn.env` and set your computer's LAN IP:

```
FQDN=localhost
LAN_IP=192.168.1.100
```

> Find your LAN IP: run `ipconfig` on Windows or `ifconfig` / `ip a` on Linux/Mac.

### Start

```
    docker-compose up -d
```

Now access:
- **This computer (HTTP)**: `http://localhost:8080`
- **This computer (HTTPS)**: `https://localhost:443`
- **Other devices (HTTPS only)**: `https://192.168.1.100:443`
- **Screen Cast**: `https://192.168.1.100:443/screen.html`

> `getDisplayMedia()` (screen sharing) requires HTTPS when accessed via LAN IP. The other devices MUST use HTTPS.

### Trust the CA Certificate

On each device that connects via HTTPS (other than localhost), you must trust the CA:

1. On the **server machine**, OpenSSL generates `snapdropCA.crt` automatically
2. Access `http://192.168.1.100:8080/ca.crt` from other devices to download it
3. Install it as a **Trusted Root Certification Authority**:
   - **Windows**: Double-click → "Install Certificate" → "Local Machine" → "Trusted Root Certification Authorities"
   - **Android**: Settings → Security → Install from storage → select the .crt file
   - **iOS**: Open .crt in Safari → Profile Downloaded → Settings → Install Profile
   - **Mac**: Double-click → Keychain Access → drag to "System" → double-click → Trust → "Always Trust"

### Docker Commands

- Restart: `docker-compose restart`
- Stop: `docker-compose stop`
- Debug NodeJS server: `docker logs snapdrop_node_1`
- Regenerate certs: `docker-compose restart nginx`


## Manual Setup (Windows, without Docker)

### Prerequisites

- [OpenSSL](https://slproweb.com/products/Win32OpenSSL.html) installed and in PATH
- [Node.js](https://nodejs.org/) installed

### Step 1: Generate Certificates

```powershell
cd scripts
.\generate-cert.ps1 -LanIp 192.168.1.100
```

This creates `scripts/certs/` with your server certificates.

### Step 2: Start the WebSocket Server

```powershell
cd server
npm install
node index.js
```

### Step 3: Start HTTPS Static Server

Use a simple Node.js HTTPS server to serve the `client/` directory:

```powershell
npx local-web-server --https --cert ..\scripts\certs\snapdrop-dev.crt --key ..\scripts\certs\snapdrop-dev.key --port 443 --directory client
```

Or use `serve` with HTTPS:

```powershell
npx serve client --ssl-cert ..\scripts\certs\snapdrop-dev.crt --ssl-key ..\scripts\certs\snapdrop-dev.key -l 443
```

### Step 4: Trust the CA (same as Docker section above)

On each client device:
1. Copy `scripts/certs/snapdropCA.crt` to the device
2. Install as Trusted Root CA


## Testing PWA related features

PWAs require that the app is served under a correctly set up and trusted TLS endpoint.

The nginx container creates a CA certificate and a website certificate for you. To correctly set the common name of the certificate, you need to change the FQDN environment variable in `docker/fqdn.env` to the fully qualified domain name of your workstation.

If you want to test PWA features, you need to trust the CA of the certificate for your local deployment. For your convenience, you can download the crt file from `http://<Your FQDN>:8080/ca.crt`. Install that certificate to the trust store of your operating system.
- On Windows, make sure to install it to the `Trusted Root Certification Authorities` store.
- On MacOS, double click the installed CA certificate in `Keychain Access`, expand `Trust`, and select `Always Trust` for SSL.
- Firefox uses its own trust store. To install the CA, point Firefox at `http://<Your FQDN>:8080/ca.crt`. When prompted, select `Trust this CA to identify websites` and click OK.
- When using Chrome, you need to restart Chrome so it reloads the trust store (`chrome://restart`). Additionally, after installing a new cert, you need to clear the Storage (DevTools -> Application -> Clear storage -> Clear site data).

Please note that the CA certificate is valid for 10 years and the server certificate is valid for 1 year.
Whenever you restart the nginx docker container, new certificates are created.

The site is served on `https://<Your FQDN>:443`.
