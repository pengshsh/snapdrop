#!/bin/sh

cnf_dir='/mnt/openssl/'
certs_dir='/etc/ssl/certs/'

# Generate CA certificate (valid 10 years)
openssl req -config ${cnf_dir}snapdropCA.cnf -new -x509 -days 3650 -keyout ${certs_dir}snapdropCA.key -out ${certs_dir}snapdropCA.crt

# Build the certificate config with IP SAN if LAN_IP is set
cert_cnf="${cnf_dir}snapdropCert.cnf"
if [ -n "$LAN_IP" ]; then
    cert_cnf="/tmp/snapdropCert.cnf"
    cp ${cnf_dir}snapdropCert.cnf $cert_cnf
    echo "IP.1 = ${LAN_IP}" >> $cert_cnf
    echo "Added LAN IP ${LAN_IP} to certificate SAN"
fi

# Generate server certificate (valid 1 year)
openssl req -config $cert_cnf -new -out /tmp/snapdrop-dev.csr -keyout ${certs_dir}snapdrop-dev.key
openssl x509 -req -in /tmp/snapdrop-dev.csr -CA ${certs_dir}snapdropCA.crt -CAkey ${certs_dir}snapdropCA.key -CAcreateserial -extensions req_ext -extfile $cert_cnf -sha512 -days 365 -out ${certs_dir}snapdrop-dev.crt

exec "$@"
