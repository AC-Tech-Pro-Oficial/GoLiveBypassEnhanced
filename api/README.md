# GoLiveBypassEnhanced — API de Bug Reports

Serviço HTTP em Go que recebe diagnósticos do app e cria issues no GitHub.

## Modelo de confiança

O endpoint de cliente é **deliberadamente público**. Um segredo embutido em um aplicativo desktop pode ser extraído e reutilizado, então não usamos um bearer token compartilhado como autenticação.

A proteção contra abuso fica no servidor:

- limite de corpo HTTP: 512 KB;
- `log` limitado por `MAX_LOG_BYTES`;
- metadados limitados em quantidade/tamanho;
- rate limit por IP e bloqueio temporário;
- `@mentions` neutralizadas antes de publicar a issue;
- headers `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer`;
- o **GITHUB_TOKEN nunca sai do servidor**.

Sem CORS é intencional: o consumidor normal é o processo principal Electron, não uma página web.

## Fluxo

```text
Desktop                         API                              GitHub
   | POST /v1/reports            |                                 |
   | {title,description,log,meta}-> valida limites/rate limit       |
   |                              | POST /repos/{repo}/issues ------>|
   | <- 201 {issue_number,url} ---|<-------------------------- 201 ---|
```

## Setup

1. Crie um PAT fine-grained com acesso somente a `AC-Tech-Pro-Oficial/GoLiveBypassEnhanced` e **Issues: write**.
2. Garanta que as labels de `ISSUE_LABELS` existam no repositório.
3. Exporte `GITHUB_TOKEN` apenas no servidor.

```sh
cd api
GITHUB_TOKEN=github_pat_... go run ./cmd/api
```

Variáveis:

| Variável | Obrig. | Padrão | Descrição |
|---|---:|---|---|
| `GITHUB_TOKEN` | sim | — | PAT server-side com Issues: write |
| `GITHUB_REPO` | não | `AC-Tech-Pro-Oficial/GoLiveBypassEnhanced` | repositório que recebe issues |
| `ISSUE_LABELS` | não | `bug,gui` | labels existentes |
| `PORT` | não | `8080` | porta HTTP |
| `RATE_LIMIT` | não | `3` | reports/minuto por IP |
| `BLOCK_SECONDS` | não | `600` | bloqueio após exceder a janela |
| `MAX_LOG_BYTES` | não | `262144` | teto do campo log |
| `BASE_PATH` | não | vazio | prefixo, ex. `bugs` |
| `LOG_LEVEL` | não | `info` | nível de log |

## Endpoints

### `POST /v1/reports`

```json
{
  "title": "Go Live não sobe após atualização",
  "description": "passos para reproduzir...",
  "log": "linhas de diagnóstico",
  "meta": {
    "app": "golive-gui",
    "version": "1.2.0",
    "os": "win32 x64"
  }
}
```

Limites adicionais de `meta`: até 32 entradas, chave até 64 bytes, valor até 512 bytes e até 8 KB no total.

Resposta:

```json
{"issue_number":123,"issue_url":"https://github.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/issues/123"}
```

### `GET /v1/block-status`

Não consome a cota. Informa `blocked`, `retry_after` ou `remaining`.

### `GET /healthz`

`200 {"status":"ok"}`.

## Teste local

```sh
curl -fsS http://127.0.0.1:8080/healthz

curl -i -X POST http://127.0.0.1:8080/v1/reports \
  -H 'Content-Type: application/json' \
  -d '{"title":"validacao local","meta":{"app":"curl"}}'
```

Não existe `API_TOKEN` de cliente. Se uma instalação antiga ainda tiver `bugReportToken`/`GOLIVE_BUG_API_TOKEN`, eles são obsoletos e ignorados.

## Docker

```sh
docker build -t golive-api api
docker run --rm -p 127.0.0.1:8080:8080 \
  -e GITHUB_TOKEN=github_pat_... \
  -e GITHUB_REPO=AC-Tech-Pro-Oficial/GoLiveBypassEnhanced \
  golive-api
```

## Operação

TLS deve terminar no reverse proxy. O serviço confia em `X-Forwarded-For` somente através de peers loopback/rede privada, que é o desenho esperado quando o container fica publicado apenas em `127.0.0.1`.

O rate limit é em memória; múltiplas réplicas exigiriam um store compartilhado (por exemplo Redis) para uma cota global.

## Testes

```sh
cd api
go vet ./...
go test ./...
```

A GUI redige credenciais/proxy antes do envio e possui uma última verificação local que bloqueia o report se um segredo conhecido sobreviver.
