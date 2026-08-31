# Site GoLiveBypass

Frontend Nuxt 3 do GoLiveBypass. O site apresenta o projeto e orienta a instalação da GUI, da CLI, do standalone e do plugin Vencord/Equicord.

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

Edite `data/release.ts` para trocar `tag`, `version` e os nomes dos assets. Os links são gerados diretamente para o GitHub e para `raw.githubusercontent.com`; o site não usa a API do GitHub.

A hospedagem e o deploy ainda não fazem parte deste projeto.
