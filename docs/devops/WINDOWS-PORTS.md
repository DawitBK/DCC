# Windows reserved ports (`listen EACCES`)

**Symptom:** the API or web app fails with `listen EACCES: permission denied 127.0.0.1:7716` (or `:7717`) although nothing uses the port.

**Cause:** Windows (Hyper-V, WSL2 and Docker Desktop) reserves dynamic blocks of ports, and which blocks changes between reboots. On
the project lead's PC on 2026-11-10 the block **7712-7911** was reserved after Docker Desktop started, which includes DCC's registered ports.

Check:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

## Fixes, easiest first

1. **Use other ports on your PC** (nothing is committed): in `.env` change `DCC_API_PORT`, `DCC_WEB_PORT`, `DCC_WEB_ORIGIN`,
   `DCC_API_INTERNAL_URL`, `OIDC_REDIRECT_URI`, `OIDC_POST_LOGOUT_URI`; update the SSO client addresses (`npm run client:uris -- --apply` in the SSO
   backend); **rebuild the web app** (`npm run build -w @dcc/web`). Pick ports outside every listed range.
2. **Reset the reservation** (administrator, then restart Docker Desktop): `net stop winnat` then `net start winnat`.
3. **Reserve DCC's ports before Windows does** (administrator, one time; works only while the ports are currently free):
   `netsh int ipv4 add excludedportrange protocol=tcp startport=7716 numberofports=2`.

The registered ports stay the standard for servers; this only affects developer PCs.
