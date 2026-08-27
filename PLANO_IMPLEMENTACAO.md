# Plano de Implementação — Manager de Futebol (web)
## Documento de arranque para o Claude Code

> Codinome de trabalho: **`[NOME_DO_JOGO]`** (renomear depois).
> Referência funcional: SRS "Simulador de Gerenciamento de Futebol" (Brasfoot-inspired), v1.0.
> Objetivo deste documento: levar o projeto do zero a um **MVP jogável** — *iniciar uma temporada e chegar ao fim dela*.

---

## 0. Como usar este documento

Trabalhe **um marco (milestone) por vez**, na ordem M0 → M7. Cada marco tem objetivo, entregáveis e um critério de verificação. **Não avance para o marco seguinte enquanto a verificação do atual não passar.** Não implemente nada das Fases 2–5 do SRS (transferências, finanças, estádio, reputação, base, etc.) — a seção 9 lista explicitamente o que fica fora do MVP.

Ao começar cada marco, escreva um resumo curto do que vai fazer e confirme a estrutura antes de gerar código em volume.

---

## 1. O que estamos construindo

Um **simulador de carreira futebolística baseado em decisões**, não um simulador visual de partidas. O jogador escala, define tática e avança rodadas; o motor simula os jogos automaticamente. A UI é leve por design (tabelas, listas, cards — SRS §39, §48). O diferencial é **simulação explicável**: o jogador entende *por que* ganhou ou perdeu (SRS §49).

**Meta do MVP (SRS §47, Fase 1 / §50):** escolher clube → ver elenco → escalar → definir estratégia → disputar partidas → chegar ao fim de uma temporada de liga → salvar/continuar.

---

## 2. Decisões de arquitetura — JÁ TOMADAS, não revisitar no MVP

- **App 100% client-side, single-player.** Sem backend. O mundo inteiro (centenas de clubes, milhares de jogadores) cabe em memória em poucos MB. Round-trips de rede só adicionariam latência.
- **Motor de simulação em TypeScript puro, rodando num Web Worker.** Mantém a UI a 60fps enquanto o processamento roda em background.
- **UI em React + Vite**, com virtualização de listas (`@tanstack/react-virtual`) para elencos e tabelas.
- **Estado é do motor, não do React.** O motor é dono do estado (objetos planos); o React apenas assina snapshots. Ponte via **Zustand**.
- **Persistência em IndexedDB via Dexie**, com export/import JSON (serve save de carreira e, no futuro, bases editáveis).
- **PRNG com seed** (ex.: `mulberry32`) para determinismo reproduzível (SRS RNF-005).
- **Rust/WASM: fora do MVP.** Reservado como otimização cirúrgica futura (só o loop quente da simulação), se e quando a medição justificar.
- **NestJS: fora do MVP.** Reservado para a Fase 5 (ranking online, multiplayer, save na nuvem).

---

## 3. Princípios de código (guardrails)

1. **O motor é uma função pura:** `(state, inputs, seed) => newState`. Sem DOM, sem React, sem `window`, sem I/O dentro do motor. Isso torna o motor testável e portável para WASM depois.
2. **Toda aleatoriedade passa pelo PRNG com seed.** Nunca usar `Math.random()` no motor. A seed vive no estado da carreira.
3. **Motor ↔ UI só conversam por mensagens do Worker** (tipadas) e snapshots imutáveis. A UI nunca muta o estado do motor diretamente.
4. **Tipos primeiro.** Definir os modelos de domínio antes da lógica.
5. **Identificadores em inglês; textos de interface em pt-BR.** (Prepara i18n sem custo agora.)
6. **Determinismo é requisito, não detalhe:** dado o mesmo estado + mesma seed + mesmas decisões, o resultado da partida é idêntico. Isso guia o design e vira teste.

---

## 4. Estrutura de pastas

```
src/
  engine/                 # TS puro, sem React — o coração
    rng.ts                # PRNG com seed (mulberry32) + helpers (pick, weighted, roll)
    types/                # modelos de domínio
      player.ts
      club.ts
      tactics.ts
      match.ts
      competition.ts
      season.ts
      career.ts
    generation/           # geração procedural de mundo
      names.ts            # gerador de nomes por nacionalidade
      players.ts
      clubs.ts
      world.ts            # monta o mundo inicial (uma liga jogável)
    simulation/
      strength.ts         # força por setor a partir de escalação+tática
      match.ts            # motor de partida (probabilístico + trace explicável)
      season.ts           # fixtures, avançar rodada, tabela, fim de temporada
    index.ts              # API pública do motor (o que o Worker expõe)

  worker/
    engine.worker.ts      # instancia o motor, roteia mensagens tipadas
    protocol.ts           # tipos das mensagens UI <-> Worker

  store/
    careerStore.ts        # Zustand: snapshot do estado + ações que chamam o Worker

  persistence/
    db.ts                 # Dexie: carreiras salvas
    serialize.ts          # export/import JSON

  ui/
    screens/              # Home, Squad, Lineup, Tactics, Table, MatchResult
    components/           # tabelas virtualizadas, cards, etc.

  main.tsx
```

---

## 5. Modelos de domínio (definir em M1, antes da lógica)

Especificar como tipos TS. Campos mínimos para o MVP (o SRS tem mais; adicionar só quando o marco pedir):

- **Player** — `id, name, age, nationality, position, secondaryPositions[], strength (0–100), attributes { finishing, speed, dribbling, passing, heading, marking, tackling, positioning, reflexes,... }, condition (0–100), morale (0–100), potential (oculto), stats da temporada`.
- **Club** — `id, name, shortName, reputation, colors, stadiumCapacity, squad: Player[]`. (Finanças/estádio ficam para a Fase 2.)
- **Tactics** — `formation (ex.: '4-4-2'), style ('offensive'|'balanced'|'defensive'|'counter'|'possession'|'direct'|'pressing')`.
- **Lineup** — `starters: PlayerId[] (11), formation, captain, penaltyTaker, freeKickTaker`. Validar nº de jogadores, posições, condição.
- **MatchResult** — `homeGoals, awayGoals, events[], stats (posse, finalizações, etc.), manOfTheMatch, explanation: Reason[]`.
- **Competition** — MVP: só liga (turno e returno). `teams[], fixtures[][], standings[]`.
- **Season** — `year, calendar, competitions, state (máquina de estados do SRS §46)`.
- **CareerState** — raiz serializável: `seed, trainer, playerClubId, world (clubs, players), season, history`. **Este objeto inteiro é o save.**

---

## 6. Marcos do MVP

### M0 — Scaffold
**Objetivo:** projeto rodando com todas as camadas fiadas (vazias, mas conectadas).
**Entregáveis:** Vite + React + TS; Zustand, Dexie, `@tanstack/react-virtual` instalados; um Web Worker "hello" respondendo a uma mensagem tipada; `rng.ts` implementado e testado.
**Verificação:** app abre; clicar num botão manda mensagem ao Worker e mostra a resposta na tela; teste unitário do PRNG prova que a mesma seed gera a mesma sequência.

### M1 — Domínio e tipos
**Objetivo:** todos os modelos da §5 como tipos TS, sem lógica.
**Verificação:** `tsc` compila; um `CareerState` de exemplo montado à mão passa numa função `validateCareerState`.

### M2 — Geração de mundo
**Objetivo:** gerar proceduralmente **uma liga jogável** (ex.: 20 clubes, ~25 jogadores cada) a partir de uma seed.
**Entregáveis:** gerador de nomes por nacionalidade; geração de jogadores com posição/força/atributos/potencial coerentes com a idade (SRS §8); montagem do mundo.
**Verificação:** dada uma seed, `generateWorld(seed)` produz sempre o mesmo mundo; distribuições de idade/força/posição parecem plausíveis (logar histograma).

### M3 — Motor de partida (a peça crítica — ver §7)
**Objetivo:** `simulateMatch(home, away, seed) => MatchResult` determinístico e **explicável**.
**Verificação:** mesma entrada + seed → resultado idêntico; rodar 10.000 partidas e conferir que times mais fortes vencem com mais frequência (mas não sempre); cada resultado traz um `explanation` legível.

### M4 — Orquestração da temporada
**Objetivo:** gerar fixtures (turno/returno), avançar rodada a rodada, atualizar tabela, detectar fim de temporada.
**Entregáveis:** `generateFixtures`, `advanceRound`, `computeStandings`; máquina de estados da temporada (SRS §46). O clube do jogador usa a escalação/tática escolhidas; os demais usam escalação automática.
**Verificação:** simular uma temporada inteira de ponta a ponta sem intervenção; a tabela final soma jogos/pontos corretamente; performance de uma rodada em milissegundos (RNF-001).

### M5 — Shell da UI
**Objetivo:** telas mínimas para jogar o loop.
**Entregáveis:** Home (próximo jogo + botão "avançar"), Elenco (lista virtualizada), Escalação (montar os 11 + validação), Tática (formação + estilo), Tabela, Resultado da partida (placar + estatísticas + **o "porquê"** do §7).
**Verificação:** dá para escalar, definir tática, avançar uma rodada e ver o resultado explicado — tudo sem travar a UI (processamento no Worker).

### M6 — Persistência
**Objetivo:** salvar/carregar múltiplas carreiras (RF-019/020, RNF-004).
**Entregáveis:** Dexie para salvar/listar/carregar `CareerState`; export/import JSON.
**Verificação:** salvar no meio de uma temporada, recarregar a página, continuar do mesmo ponto; exportar e reimportar reproduz a carreira idêntica.

### M7 — Loop jogável (Definição de Pronto)
**Objetivo:** costurar tudo num fluxo contínuo.
**Verificação:** o critério de sucesso do MVP na §8 passa inteiro.

---

## 7. O motor de partida em detalhe (M3)

Modelo simples, probabilístico e **explicável**. Nada de física ou minuto a minuto obrigatório.

**1. Força por setor** — a partir da escalação e da tática, calcular três notas por time:
- `defense` = média ponderada do goleiro + defensores (marcação, desarme, posicionamento, reflexos).
- `midfield` = média dos meio-campistas (passe, controle) — governa a **posse**.
- `attack` = média dos atacantes (finalização, velocidade, drible).
- Cada nota é modulada por **moral, condição física e adequação à posição** (jogador improvisado rende menos — SRS §14: `força efetiva = base + bônus de posição + característica + tático + experiência + condição`).

**2. Modificadores globais:**
- **Fator casa** (bônus fixo ao mandante).
- **Estilo tático** altera a curva risco/volume: `offensive` → mais chances criadas **e** mais concedidas; `defensive` → menos de ambas; `counter` → poucas chances, mas de alta qualidade contra estilos ofensivos. Modelar como multiplicadores sobre nº e qualidade de chances.
- **Confronto de estilos** gera parte da explicação (ex.: formação ofensiva exposta a contra-ataque).

**3. Posse** — derivada da razão `midfield_A / (midfield_A + midfield_B)`.

**4. Geração de chances** — nº de chances de cada time em função de `attack` vs `defense` do adversário, posse e estilo. Para cada chance, um `roll()` com seed decide gol/defesa/erro/rebote, ponderado por qualidade da finalização vs qualidade do goleiro (SRS §16).

**5. Saída** — `MatchResult` com placar, eventos, estatísticas, melhor em campo e um **`explanation: Reason[]`**, onde `Reason = { factor, impact, note }`. Ex.: `{ factor: 'style_mismatch', impact: -0.15, note: 'Sua linha alta foi explorada nos contra-ataques' }`. **Esse trace é o diferencial do produto (SRS §49) — não é opcional.**

Manter os pesos/constantes num único arquivo de config para facilitar o balanceamento.

---

## 8. Definição de Pronto do MVP

O MVP está pronto quando, num fluxo único, o jogador consegue:

1. Iniciar uma nova carreira (seed gerada).
2. Escolher um clube da liga.
3. Ver o elenco.
4. Montar a escalação (com validação).
5. Definir formação e estilo.
6. Avançar rodada e ver o resultado **com a explicação do porquê**.
7. Repetir até o fim da temporada.
8. Ver a tabela final / campeão.
9. Salvar e, após recarregar, continuar do mesmo ponto.

Tudo isso sem a UI travar (processamento no Worker) e com uma rodada simulada em milissegundos.

---

## 9. O que NÃO fazer agora (fora do MVP)

Nada das Fases 2–5 do SRS: transferências, contratos, salários, finanças, bilheteria, estádio, treinamento, reputação, ofertas de emprego, seleções, rankings, categorias de base, lesões, moral evolutiva da torcida, rivalidades, eventos aleatórios, notícias, editor de banco, multiplayer, ranking online. **Também não introduzir Rust/WASM nem NestJS.** O motor deve nascer puro e desacoplado justamente para acomodar isso depois sem reescrita.

---

## 10. Primeiro passo concreto

Comece pelo **M0**: scaffold Vite+React+TS, instale as dependências, implemente e teste o `rng.ts`, e prove o canal UI ↔ Worker com uma mensagem tipada de ida e volta. Confirme a estrutura de pastas da §4 antes de seguir.
