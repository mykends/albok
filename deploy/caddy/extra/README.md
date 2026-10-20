Files named `*.caddy` in this folder are imported into the site block of the Caddyfile.

To use a certificate provided by the school instead of Let's Encrypt, create `tls.caddy`:

```
tls /certs/fullchain.pem /certs/privkey.pem
```

and put the certificate files in `deploy/certs/` (mounted at `/certs`).
