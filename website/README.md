# Site GoLiveBypass

Frontend Nuxt 3 do GoLiveBypass. O site apresenta o projeto, baixa a GUI e orienta a instalação por comandos do standalone e do plugin Vencord/Equicord, com opções TUI e sem TUI.

## Desenvolvimento local

```sh
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Validação estática

```sh
npm run typecheck
npm run generate
npm run preview
```

A saída estática fica em `.output/public`.

## Atualizar downloads

Edite `data/release.ts` para trocar `tag`, `version` e os nomes dos assets. Os comandos de terminal ficam em `data/install.ts`. Os links são gerados diretamente para o GitHub e para `raw.githubusercontent.com`; o site não usa a API do GitHub.

A hospedagem e o deploy ainda não fazem parte deste projeto.
