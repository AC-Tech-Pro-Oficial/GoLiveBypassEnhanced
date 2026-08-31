# Recuperação nativa do RTC do Go Live

Data: 2026-08-31

## Contexto e evidência

A beta 10 tenta observar mídia envolvendo `window.RTCPeerConnection`. O Discord
desktop atual, porém, cria as conexões reais no módulo nativo `discord_voice`.
No teste ao vivo desta data, o probe permaneceu em `pcs=0` durante toda a Live,
mesmo com o encoder nativo entregando aproximadamente 60 FPS.

O travamento foi reproduzido e delimitado:

- com um espectador, o transmissor codificou normalmente por cerca de sete
  minutos;
- o espectador passou a ver carregamento infinito;
- o log nativo continuou recebendo `Remote media sink wants` com demanda
  positiva, mas `Received receiver count` caiu para zero;
- a captura permaneceu em aproximadamente 60 FPS, enquanto quadros codificados,
  bitrate e bytes enviados pararam de crescer; o próprio stats ainda dizia
  `suspended=false`, portanto essa flag não serve como gatilho;
- fechar duas vezes os WebSockets de mídia com código 4000 não curou;
- parar e recriar somente a Go Live, inclusive com SSRC novo, não curou;
- parar de assistir e abrir novamente no espectador não curou;
- recarregar o espectador não curou;
- somente o reload do transmissor destruiu o estado, ao custo de encerrar a Go
  Live e reconstruir a call.

Isso demonstra duas falhas da beta 10: a fonte de telemetria não enxerga o RTC
real e a recuperação por WebSocket não reinicializa o estado nativo preso.

## Objetivo

Detectar o estado zumbi pelo `discord_voice` e recuperá-lo sem o bypass chamar
reload. É aceitável um corte breve de áudio e uma reconstrução interna iniciada
pelo próprio Discord, desde que o estado lógico da call/Live seja restaurado
sozinho.

Não são objetivos:

- rotear mídia pelo proxy;
- trocar a saída do gateway;
- recarregar automaticamente o renderer;
- agir quando não existe demanda real de espectador;
- depender da leitura do arquivo `discord-webrtc_0` em produção.

## Arquitetura

### 1. Hook do módulo nativo

O preload de sessão, antes do bundle do Discord, envolve de forma idempotente
`DiscordNative.nativeModules.requireModule`. Quando `discord_voice` for
requisitado, envolve uma única vez:

- `createVoiceConnectionWithOptions`;
- `createOwnStreamConnectionWithOptions`.

Os wrappers chamam as funções originais sem alterar argumentos ou retorno e
registram a conexão devolvida. A classificação entre `default` e `stream` usa
somente campos estruturais das opções confirmados no protótipo. Se a versão do
Discord não oferecer uma classificação inequívoca, a conexão fica como
`unknown` e nunca é destruída automaticamente.

Cada registro mantém identificador local, tipo, instante de criação, estado de
destruição e amostras sanitizadas. IDs de usuário, canal, guilda, endereço e
token não entram no resumo nem no log.

### 2. Stats reais e sinal de demanda

O protótipo ao vivo revelou uma incompatibilidade no wrapper distribuído pelo
Discord: ele ainda expõe `getStats`, mas o objeto nativo atual não implementa
esse método. A API funcional é `connection.getFilteredStats(2, callback)`; o
filtro `2` devolve `outbound` + `screenshare` como JSON. O preload a amostra sem
substituir callbacks do Discord e reduz o resultado aos campos úteis:

- quadros de entrada/captura;
- quadros codificados ou enviados;
- FPS e bitrate de saída;
- presença de trilha de vídeo;
- estado da conexão e idade da última progressão.

Antes de fixar nomes de campos, o protótipo registra apenas as chaves e tipos do
objeto devolvido. Formato desconhecido degrada para telemetria indisponível e
nunca dispara recuperação.

O preload também observa, preservando integralmente o console original, as
mensagens `Remote media sink wants`. Um payload positivo ativa a demanda e um
payload inequivocamente zerado a desativa; a última mudança fica datada. Esse
estado diferencia o zumbi de uma transmissão saudável sem espectadores e evita
depender de uma expiração arbitrária, pois a mensagem é orientada a mudança.

As duas metades vivem em mundos diferentes: o addon e as conexões estão no
preload isolado do Electron (world 999), enquanto os logs de demanda e os
WebSockets estão no mundo principal. O processo principal consulta ambos e os
combina; nenhuma ponte transporta objetos nativos entre mundos.

O renderer expõe ao processo principal apenas:

- `__goliveVoiceResumo()` para o resumo assíncrono;
- `__goliveVoiceRecuperar(nivel)` para uma ação explicitamente escolhida pelo
  vigia.

### 3. Detector puro

Uma função pura decide entre `null` e `video-nativo-travado`. Todas as condições
abaixo são obrigatórias:

- `autoRevive` ligado;
- conexão `stream` classificada com confiança e criada há pelo menos 20 s;
- WebSocket de mídia aberto;
- demanda positiva conhecida, observada desde a geração atual da stream;
- captura/entrada de vídeo progrediu nos últimos 15 s;
- quadros/bytes codificados não progrediram por pelo menos 20 s;
- usuário continua transmitindo;
- nenhuma recuperação está no cooldown;
- nenhuma amostra está incompleta ou com formato desconhecido.

Uma queda momentânea de receiver, troca de codec, renegociação DAVE ou criação
recente da stream reinicia o aquecimento e não dispara ação.

### 4. Escada de recuperação

Nível 1 — stream nativa:

1. marcar a tentativa e suspender novas decisões;
2. chamar `destroy()` somente na conexão nativa `stream` atual;
3. não fechar WebSocket no nível 1, pois a associação URL → stream não é
   inequívoca no cliente atual;
4. aguardar 60 s pelo teardown tardio. Se voice/mídia já estiverem fechando,
   conceder mais 45 s ao controlador; toda geração nova recebe 30 s próprios de
   aquecimento. A cura só vale com progressão estável por pelo menos 10 s.

Nível 2 — RTC completo, sem reload:

1. destruir as conexões nativas `stream` e `default` conhecidas;
2. fechar todos os WebSockets `discord.media` com código 4000;
3. deixar o controlador do Discord reconstruir a call e a stream;
4. aceitar um corte breve de áudio, mas conferir que o canal lógico continua
   selecionado e que uma geração nativa nova nasceu.

Se o nível 2 não recuperar em 45 s, a automação para e mostra banner dedicado.
Não há nível de reload automático. O teto é de duas tentativas em 30 minutos.

Sucesso só é creditado quando demanda continua positiva e quadros ou bytes de
vídeo progridem durante o aquecimento. Um único quadro-chave ou `viewer=1`
transitório, como os pulsos de 49–156 ms observados no teste, não conta.

## Resultado do ensaio ao vivo

A segunda ocorrência natural da falha forneceu a fixture real do detector:

- durante 15 s, `pipewireFrames` avançou de 2.760 para 3.667 e
  `inputFrameRate` ficou em 60–61 fps;
- demanda positiva chegou repetidamente e o WebSocket de mídia permaneceu
  aberto;
- `framesEncoded=0`, `encodeFrameRate=0`, bitrate 0 e resolução 0×0 em todas as
  amostras; o log nativo confirmou receiver count 0.

O `destroy()` apenas da stream encerrou imediatamente a geração antiga. Ela não
renasceu nos primeiros 30 s, mas iniciou uma reconstrução tardia sem ação útil
do nível 2: voice/mídia fecharam, o Discord criou documento/preload novos,
reentrou na call e recriou a Live. A nova geração chegou a dois receptores e
estabilizou em aproximadamente 60 fps, 1920×1088; em uma janela adicional de
25 s, `framesEncoded` cresceu continuamente de 3.209 para 4.711. Portanto, o
nível 1 é uma cura válida, porém assíncrona, e a escada precisa reconhecer o
teardown/reload interno em vez de atropelá-lo.

## Falha segura e compatibilidade

- Toda exceção no hook devolve imediatamente ao comportamento original.
- Métodos ausentes, stats desconhecidos ou tipo de conexão ambíguo desabilitam
  somente a recuperação nativa e geram uma linha diagnóstica.
- O hook é idempotente e sobrevive a múltiplas vias de injeção.
- Nenhuma URL completa de WebSocket, opção bruta de conexão ou objeto de stats é
  persistido.
- A decisão continua proibida durante criação, encerramento voluntário e período
  de aquecimento.
- O comportamento deve ser portado para a GUI pelo `sync-bypass`. O plugin
  Vencord/Equicord exige porte manual; se não entrar na mesma versão, a lacuna é
  registrada explicitamente no `CHANGELOG.md`.

## Observabilidade

Novas linhas resumidas:

- `voice.hook | discord_voice interceptado`;
- `voice.conn | tipo=stream geracao=N estado=...`;
- `voice.probe | stream=... demanda_ha=... entrada_ha=... saida_ha=...`;
- `gw.revive | video nativo: nivel=1 ...`;
- `gw.revive | video nativo: nivel=2 ...`;
- `gw.revive | video nativo: sucesso ...`;
- `gw.zumbi | video nativo confirmado mas acao manual (...)`.

## Testes

### Automatizados

- hook idempotente e transparente com módulo falso;
- classificação segura de `default`, `stream` e `unknown`;
- adaptação de múltiplos formatos de stats;
- detector não age sem demanda, sem captura viva, durante aquecimento ou com
  amostra desconhecida;
- detector age com demanda positiva + entrada viva + saída congelada;
- nível 1 destrói somente `stream`;
- nível 2 destrói `stream` e `default` e fecha mídia;
- sucesso exige progressão sustentada, não pulso transitório;
- teto, cooldown e logs sem identificadores sensíveis.

### Ao vivo no Linux

1. instalar build local e confirmar `voice.hook` antes da criação da call;
2. iniciar Go Live com um espectador e validar stats nativos enquanto o probe
   antigo continua irrelevante;
3. aguardar a falha natural ou reproduzir a condição sem derrubar gateway;
4. confirmar a assinatura de zumbi;
5. observar o nível 1; se falhar, o nível 2 deve manter o usuário no canal;
6. considerar sucesso apenas com pelo menos 60 s de vídeo contínuo após a cura;
7. repetir sem espectador por dez minutos para provar ausência de falso positivo.

## Entrega

A implementação começa no standalone, fonte da verdade. A GUI é regenerada com
`npm run sync-bypass`/`npm run compile`. O CHANGELOG descreve a substituição do
probe RTC da beta 10 e qualquer lacuna temporária do plugin. A publicação, se
solicitada depois dos testes, deve usar uma tag prerelease e o canal beta.
