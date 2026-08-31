# Plano de implementação — recuperação nativa do RTC

Especificação: `docs/superpowers/specs/2026-08-31-native-rtc-recovery-design.md`

## Estado após o ensaio ao vivo

- Instrumentação, formato real e detector: concluídos.
- API confirmada: `getFilteredStats(2, callback)`, não `getStats()`.
- Uma terceira ocorrência invalidou a escada destrutiva: `destroy(stream)` fez a
  demanda cair, e o nível 2 recriou voice/stream sem fonte de vídeo
  (`stats=sem-video`).
- O objeto nativo confirmou a API segura para o novo desenho:
  `setDesktopSource`, `setDesktopSourceWithOptions` e `clearDesktopSource`.
- Próxima implementação: guardar a última configuração somente em memória,
  reaplicá-la no nível 1 e fazer clear + replay no nível 2, sem destruir RTC nem
  fechar mídia.

## 1. Instrumentação nativa isolada

Arquivos:

- modificar `standalone/golivebypass.js`;
- adicionar `tests/test-native-rtc-recovery.cjs`;
- adicionar `tests/test-native-rtc-recovery.sh`.

Passos:

1. Extrair a construção do shim nativo para uma seção delimitada e testável.
2. Envolver `DiscordNative.nativeModules.requireModule` de forma idempotente.
3. Envolver os dois criadores de conexão sem alterar argumentos, `this`, retorno
   ou exceções.
4. Envolver `setDesktopSource*`/`clearDesktopSource`, mantendo os argumentos por
   referência apenas no closure e nunca no resumo.
5. Manter registros locais sanitizados e expor um resumo somente leitura.
6. Criar testes com módulos falsos para transparência, idempotência, falha
   segura e ausência de IDs no resumo.
7. Rodar `node tests/test-native-rtc-recovery.cjs`.

## 2. Descoberta controlada do formato real

Arquivos:

- modificar `standalone/golivebypass.js` somente se o protótipo exigir ajuste;
- não persistir fixtures com IDs ou payloads brutos.

Passos:

1. Injetar a instrumentação passiva no renderer atual antes de iniciar uma nova
   Go Live.
2. Registrar apenas nomes de campos e tipos das opções de conexão.
3. Invocar a API realmente presente (`getFilteredStats(2, callback)`) e registrar
   somente nomes de campos, tipos e contadores numéricos relevantes.
4. Confirmar a regra inequívoca para `default` e `stream`.
5. Confirmar quais contadores avançam com captura ativa e quais congelam no
   estado zumbi.
6. Se a estrutura não for inequívoca, manter recuperação desativada e revisar o
   adaptador antes de prosseguir.

## 3. Adaptador de stats e demanda

Arquivos:

- modificar `standalone/golivebypass.js`;
- ampliar `tests/test-native-rtc-recovery.cjs`.

Passos:

1. Implementar normalização dos formatos confirmados de `getStats()`.
2. Rastrear progressão de entrada, saída, bytes e geração da conexão.
3. Observar `Remote media sink wants`, chamar o console original e armazenar
   apenas instante/booleano de demanda positiva.
4. Testar payload válido, zero, malformado e mudanças de formato.
5. Garantir que objetos brutos nunca apareçam no log.

## 4. Decisão pura e escada

Arquivos:

- modificar `standalone/golivebypass.js`;
- ampliar `tests/test-native-rtc-recovery.cjs`;
- ajustar `tests/test-gateway-zumbi-revive.cjs` se o vigia compartilhado mudar.

Passos:

1. Implementar `avaliarRtcNativo` como função pura.
2. Cobrir todas as guardas da especificação com relógio controlado.
3. Implementar nível 1: reaplicar a última chamada `setDesktopSource*` na mesma
   conexão, sem destruir nada.
4. Implementar nível 2: `clearDesktopSource()` + replay após pausa curta, sem
   fechar voice, stream, mídia ou gateway.
5. Implementar cooldown, teto, aquecimento e crédito de sucesso sustentado.
6. Remover o probe de `window.RTCPeerConnection` da tomada de decisão; mantê-lo
   temporariamente apenas como diagnóstico legado se não gerar confusão.

## 5. Integração e distribuição

Arquivos:

- modificar `CHANGELOG.md`;
- regenerar `golive-gui/electron/bypass.ts` com `npm run sync-bypass`;
- avaliar `goLiveBypass/native.ts` e `goLiveBypass/index.tsx`.

Passos:

1. Documentar a evidência da issue #164 e a substituição da telemetria beta 10.
2. Portar o comportamento ao plugin apenas se as APIs nativas e o ciclo de vida
   permitirem as mesmas guardas. Caso contrário, registrar a lacuna explicitamente.
3. Rodar o sync da GUI e verificar que o arquivo gerado corresponde ao standalone.
4. Não publicar release nem criar tag durante esta tarefa.

## 6. Verificação automatizada

Comandos:

1. `node tests/test-native-rtc-recovery.cjs`
2. `./tests/test-gateway-zumbi-revive.sh`
3. `npm test -- --run` dentro de `golive-gui/`
4. `npm run compile` dentro de `golive-gui/`
5. `git diff --check`

Critério: todos os testes existentes e novos passam; o diff não contém arquivo
gerado fora de sincronia nem alteração incidental do usuário.

## 7. Verificação ao vivo

1. Instalar o standalone local atualizado no Discord oficial.
2. Reiniciar o Discord com logging e CDP somente para observação.
3. Confirmar que `voice.hook` aparece antes das conexões nativas.
4. Iniciar call e Go Live com um espectador.
5. Validar `voice.probe` saudável e ausência de ação sem espectador.
6. Aguardar falha natural; no zumbi, conferir demanda positiva + entrada viva +
   saída congelada.
7. Validar nível 1 e, se necessário, nível 2.
8. Exigir pelo menos 60 segundos de progressão após a cura e confirmar que o
   usuário permaneceu no canal.

## Critérios de parada segura

- Não destruir conexão `unknown`.
- Não chamar `destroy()` em conexão conhecida como forma de recuperação.
- Não escalar com stats incompletos.
- Não usar reload automático.
- Não mexer no gateway durante mídia ativa.
- Se clear + replay não restabelecer progressão após o nível 2, desabilitar a
  ação automática e manter apenas telemetria/banner; nunca voltar à escada
  destrutiva.
