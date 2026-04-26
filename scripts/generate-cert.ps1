<#
.SYNOPSIS
    Generate self-signed certificates for Snapdrop LAN usage
.DESCRIPTION
    Generates a CA certificate and a server certificate with LAN IP in SAN.
    Run this script, then trust the generated CA cert on all devices.
.PARAMETER LanIP
    Your computer's LAN IP address, e.g. 192.168.1.100
.PARAMETER OutputDir
    Directory to output certificate files (default: ./certs)
.EXAMPLE
    .\generate-cert.ps1 -LanIP 192.168.1.100
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$LanIP,

    [string]$OutputDir = "$PSScriptRoot\certs"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$caKey = "$OutputDir\snapdropCA.key"
$caCrt = "$OutputDir\snapdropCA.crt"

Write-Host "Generating CA certificate (valid 10 years)..." -ForegroundColor Cyan
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes `
    -keyout $caKey -out $caCrt `
    -subj "/O=Snapdrop/OU=CA/CN=snapdrop-CA" `
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" `
    -addext "keyUsage=critical,digitalSignature,keyEncipherment,cRLSign,keyCertSign" `
    -addext "subjectKeyIdentifier=hash"

Write-Host "Generating server certificate with IP SAN (valid 1 year)..." -ForegroundColor Cyan

$certConf = @"
[req]
default_bits = 2048
default_md = sha256
encrypt_key = no
distinguished_name = subject
req_extensions = req_ext
string_mask = utf8only
prompt = no

[subject]
O = Snapdrop
OU = Development
CN = localhost

[req_ext]
subjectKeyIdentifier = hash
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
subjectAltName = DNS:localhost,IP:$LanIP
extendedKeyUsage = serverAuth
"@

$certConfPath = "$OutputDir\server.cnf"
$certConf | Out-File -FilePath $certConfPath -Encoding ascii

$serverKey = "$OutputDir\snapdrop-dev.key"
$serverCsr = "$OutputDir\snapdrop-dev.csr"
$serverCrt = "$OutputDir\snapdrop-dev.crt"

openssl req -new -config $certConfPath -keyout $serverKey -out $serverCsr
openssl x509 -req -in $serverCsr -CA $caCrt -CAkey $caKey -CAcreateserial `
    -extfile $certConfPath -extensions req_ext -sha512 -days 365 -out $serverCrt

Remove-Item $certConfPath, $serverCsr

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Certificates generated successfully!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Files created in: $OutputDir" -ForegroundColor Yellow
Write-Host "  - snapdropCA.crt   (CA certificate, trust this on all devices)"
Write-Host "  - snapdropCA.key   (CA private key)"
Write-Host "  - snapdrop-dev.crt (Server certificate)"
Write-Host "  - snapdrop-dev.key (Server private key)"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Double-click snapdropCA.crt to install it as Trusted Root CA"
Write-Host "  2. Start Snapdrop with HTTPS using these certificates"
Write-Host "  3. Access https://${LanIP}:443 on other devices"
