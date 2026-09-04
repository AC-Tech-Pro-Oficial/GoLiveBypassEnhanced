# Runbook — API de bug reports em api.skyplaceia.com

A API roda em container isolado atrás do OpenLiteSpeed/CyberPanel, que termina TLS.

```text
Internet :443
    |
OpenLiteSpeed /bugs
    |
127.0.0.1:8091 -> container Go
    |
api.github.com
```

A porta do container fica publicada somente em loopback.

## Rotas

- Health: `https://api.skyplaceia.com/bugs/healthz`
- Reports: `https://api.skyplaceia.com/bugs/v1/reports`
- Cota: `https://api.skyplaceia.com/bugs/v1/block-status`

`BASE_PATH=bugs` deve estar configurado no container.

## Segredo

Existe somente um segredo operacional de cliente externo: **`GITHUB_TOKEN` no servidor**.

Não configure `API_TOKEN`, `bugReportToken` ou bearer token no app. O endpoint de report é público porque qualquer segredo distribuído no binário seria extraível; abuso é contido por limites de payload + rate limit/bloqueio por IP.

O PAT deve ser fine-grained, limitado ao repositório `AC-Tech-Pro-Oficial/GoLiveBypassEnhanced`, com **Issues: Read and write** e sem permissões de código.

## Deploy

```sh
cd /caminho/para/repo/api
cp .env.example .env
chmod 600 .env
# editar GITHUB_TOKEN e BASE_PATH=bugs

./deploy/deploy.sh
```

O vhost deve manter o `context /bugs { type proxy ... }` já documentado em `openlitespeed-vhost.conf`. Não substitua os outros serviços do domínio.

## Verificação

```sh
curl -fsS https://api.skyplaceia.com/bugs/healthz

curl -i -X POST https://api.skyplaceia.com/bugs/v1/reports \
  -H 'Content-Type: application/json' \
  -d '{"title":"validacao deploy","description":"teste pos-deploy","meta":{"app":"curl"}}'

curl -fsS https://api.skyplaceia.com/bugs/v1/block-status
```

O POST válido deve retornar `201` com `issue_number` e `issue_url`.

Confirme também os serviços existentes do domínio após qualquer alteração no vhost.

## Operação

| Tarefa | Comando |
|---|---|
| Logs | `docker compose logs -f` |
| Status | `docker compose ps` |
| Atualizar | `git pull && ./deploy/deploy.sh` |
| Reiniciar | `docker compose restart` |

### Rotação do GitHub PAT

Atualize `GITHUB_TOKEN` em `api/.env` e recrie:

```sh
docker compose up -d --force-recreate
```

Nenhuma atualização de cliente é necessária, porque o PAT nunca é distribuído.

## Limitações

- rate limit em memória; reinício zera contadores;
- múltiplas réplicas precisam de store compartilhado;
- sem CORS por design;
- o container final é mínimo/read-only e não contém shell.
