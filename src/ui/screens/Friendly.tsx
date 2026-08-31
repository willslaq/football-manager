import { useEffect, useMemo, useRef, useState } from 'react';
import { generateWorld, simulateMatch } from '../../engine';
import type { MatchTeamInput } from '../../engine';
import { autoAssign, buildSlots, slotPositionsByPlayer } from '../../engine/simulation/formation';
import type {
  Club,
  ClubId,
  EngineTraceEntry,
  Formation,
  MatchResult as MatchResultData,
  Player,
  TacticalIntensity,
  TacticStyle,
  World,
} from '../../engine/types';
import {
  runLiveMatch,
  type ChanceTraceEntry,
  type EnergyTraceEntry,
  type LiveMatchController,
  type LiveMatchSpeed,
  type LiveMatchTraces,
  type PossessionTraceEntry,
} from '../../worker/liveMatch';
import { Backdrop, Button, PitchEditor } from '../components';
import { CLUB_CRESTS } from '../clubCrests';
import { computeLineupStatus, type LineupStatus } from '../lineupStatus';
import { FriendlyLive, type FriendlyLiveState } from './FriendlyLive';
import { FriendlyResult } from './FriendlyResult';
import './Friendly.css';

/** Seed fixa — squads e ratings sempre iguais entre sessões (só afeta atributos procedurais de jogadores sem dado real do mod). */
const FRIENDLY_WORLD_SEED = 1;
const FRIENDLY_TACTICAL_INTENSITY: TacticalIntensity = 'subtle';
const DEFAULT_FORMATION: Formation = '4-4-2';
const DEFAULT_STYLE: TacticStyle = 'balanced';

interface SideState {
  clubId: ClubId | null;
  formation: Formation;
  style: TacticStyle;
  assignments: Record<string, string | null>;
}

function emptySide(): SideState {
  return { clubId: null, formation: DEFAULT_FORMATION, style: DEFAULT_STYLE, assignments: {} };
}

function resolveClubSquad(world: World, clubId: ClubId | null): Player[] {
  if (!clubId) return [];
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) return [];
  const byId = new Map(world.players.map((p) => [p.id, p]));
  return club.squad.map((id) => byId.get(id)).filter((p): p is Player => !!p);
}

function buildFriendlyTeamInput(side: SideState, world: World): MatchTeamInput {
  const slots = buildSlots(side.formation);
  const byId = new Map(world.players.map((p) => [p.id, p]));
  const starterIds = Object.values(side.assignments).filter((id): id is string => !!id);
  return {
    clubId: side.clubId!,
    players: starterIds.map((id) => byId.get(id)!),
    tactics: { formation: side.formation, style: side.style },
    slotPositionByPlayerId: slotPositionsByPlayer(slots, side.assignments),
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

/** Mesmo split usado pelo worker (ver engine.worker.ts's `case 'startMatch'`) pra alimentar `runLiveMatch`. */
function splitLiveTraces(trace: EngineTraceEntry[]): LiveMatchTraces {
  return {
    chances: trace.filter((e): e is ChanceTraceEntry => e.kind === 'chance'),
    possession: trace.filter((e): e is PossessionTraceEntry => e.kind === 'possession'),
    energy: trace.filter((e): e is EnergyTraceEntry => e.kind === 'energy'),
  };
}

interface FriendlySideProps {
  idPrefix: string;
  label: string;
  side: SideState;
  otherClubId: ClubId | null;
  clubs: Club[];
  squad: Player[];
  status: LineupStatus;
  onPickClub: (clubId: ClubId) => void;
  onFormationChange: (formation: Formation) => void;
  onStyleChange: (style: TacticStyle) => void;
  onAssignmentsChange: (assignments: Record<string, string | null>) => void;
}

function FriendlySide({
  idPrefix,
  label,
  side,
  otherClubId,
  clubs,
  squad,
  status,
  onPickClub,
  onFormationChange,
  onStyleChange,
  onAssignmentsChange,
}: FriendlySideProps) {
  const club = clubs.find((c) => c.id === side.clubId);
  const selectId = `${idPrefix}-club`;

  return (
    <section className="friendly-side">
      <div className="friendly-side__header">
        <span className="eyebrow">{label}</span>
        {club && CLUB_CRESTS[club.id] && <img className="friendly-side__crest" src={CLUB_CRESTS[club.id]} alt="" />}
        <div className="friendly-side__club field">
          <label className="field__label" htmlFor={selectId}>
            Clube
          </label>
          <select
            id={selectId}
            className="field__input"
            value={side.clubId ?? ''}
            onChange={(e) => e.target.value && onPickClub(e.target.value)}
          >
            <option value="" disabled>
              Selecione um clube
            </option>
            {clubs
              .filter((c) => c.id !== otherClubId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        {side.clubId && (
          <span className={status.isValid ? 'lineup__status--valid' : 'lineup__status--invalid'}>
            {status.assignedIds.length}/11{!status.hasGoalkeeper ? ' · sem goleiro' : ''}
          </span>
        )}
      </div>

      {side.clubId && (
        <PitchEditor
          idPrefix={idPrefix}
          formation={side.formation}
          style={side.style}
          onFormationChange={onFormationChange}
          onStyleChange={onStyleChange}
          tacticalIntensity={FRIENDLY_TACTICAL_INTENSITY}
          squad={squad}
          assignments={side.assignments}
          onAssignmentsChange={onAssignmentsChange}
          compact
        />
      )}
    </section>
  );
}

export function Friendly({ onBack }: { onBack: () => void }) {
  const world = useMemo(() => generateWorld(FRIENDLY_WORLD_SEED), []);
  const clubs = useMemo(() => [...world.clubs].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [world]);

  const [home, setHome] = useState<SideState>(emptySide);
  const [away, setAway] = useState<SideState>(emptySide);
  const [phase, setPhase] = useState<'setup' | 'live' | 'result'>('setup');
  const [matchResult, setMatchResult] = useState<MatchResultData | null>(null);
  const [live, setLive] = useState<FriendlyLiveState | null>(null);
  /**
   * Criado direto no clique de "Simular partida" (nunca dentro de um `useEffect`) — sob
   * StrictMode, um efeito que iniciasse a transmissão no mount rodaria montado→limpo→montado de
   * novo, e a limpeza chamando `skip()` entregaria a partida inteira instantaneamente antes da
   * segunda montagem "de verdade" (foi exatamente o bug visto ao testar: o placar já vinha pronto,
   * sem nenhuma transmissão ao vivo visível).
   */
  const controllerRef = useRef<LiveMatchController | null>(null);

  useEffect(() => {
    // Só existe algo pra limpar se uma partida já estava em transmissão quando a tela sair —
    // durante o ciclo fantasma do StrictMode `controllerRef.current` ainda é `null` aqui, então
    // esse efeito é inofensivo (skip() só é chamado de verdade num desmonte real em andamento).
    return () => controllerRef.current?.skip();
  }, []);

  const homeSquad = useMemo(() => resolveClubSquad(world, home.clubId), [world, home.clubId]);
  const awaySquad = useMemo(() => resolveClubSquad(world, away.clubId), [world, away.clubId]);
  const homePlayersById = useMemo(() => new Map(homeSquad.map((p) => [p.id, p])), [homeSquad]);
  const awayPlayersById = useMemo(() => new Map(awaySquad.map((p) => [p.id, p])), [awaySquad]);

  const homeStatus = computeLineupStatus(home.assignments, homePlayersById);
  const awayStatus = computeLineupStatus(away.assignments, awayPlayersById);
  const canSimulate = !!home.clubId && !!away.clubId && homeStatus.isValid && awayStatus.isValid;

  function pickClub(side: 'home' | 'away', clubId: ClubId) {
    const current = side === 'home' ? home : away;
    const setSide = side === 'home' ? setHome : setAway;
    const squad = resolveClubSquad(world, clubId);
    setSide({ ...current, clubId, assignments: autoAssign(buildSlots(current.formation), squad) });
  }

  function runSimulation() {
    if (!canSimulate) return;
    controllerRef.current?.skip();
    const trace: EngineTraceEntry[] = [];
    const result = simulateMatch(
      buildFriendlyTeamInput(home, world),
      buildFriendlyTeamInput(away, world),
      randomSeed(),
      FRIENDLY_TACTICAL_INTENSITY,
      (entry) => trace.push(entry),
    );
    const traces = splitLiveTraces(trace);
    setMatchResult(result);
    setLive({ minute: 0, homeGoals: 0, awayGoals: 0, possessionHome: 50, events: [], paused: false, speed: 1 });
    setPhase('live');

    const controller = runLiveMatch(result, traces, {
      onEvent: (event, homeGoals, awayGoals) =>
        setLive((s) => (s ? { ...s, events: [...s.events, event], homeGoals, awayGoals } : s)),
      onTrace: () => {},
      onTick: (minute, homeGoals, awayGoals, possessionHome) =>
        setLive((s) => (s ? { ...s, minute, homeGoals, awayGoals, possessionHome } : s)),
    });
    controllerRef.current = controller;
    controller.done.then(() => setPhase('result'));
  }

  function togglePause() {
    if (!live) return;
    const next = !live.paused;
    controllerRef.current?.setPaused(next);
    setLive({ ...live, paused: next });
  }

  function setSpeed(speed: LiveMatchSpeed) {
    if (!live) return;
    controllerRef.current?.setSpeed(speed);
    setLive({ ...live, speed });
  }

  if ((phase === 'live' || phase === 'result') && matchResult && live && home.clubId && away.clubId) {
    const homeClub = world.clubs.find((c) => c.id === home.clubId)!;
    const awayClub = world.clubs.find((c) => c.id === away.clubId)!;
    const playersById = new Map(world.players.map((p) => [p.id, p]));

    if (phase === 'live') {
      return (
        <FriendlyLive
          homeClub={homeClub}
          awayClub={awayClub}
          playersById={playersById}
          live={live}
          onTogglePause={togglePause}
          onSetSpeed={setSpeed}
          onSkip={() => controllerRef.current?.skip()}
        />
      );
    }

    return (
      <FriendlyResult
        result={matchResult}
        homeClub={homeClub}
        awayClub={awayClub}
        playersById={playersById}
        onPlayAgain={runSimulation}
        onRebuild={() => setPhase('setup')}
        onBackToStart={onBack}
      />
    );
  }

  return (
    <Backdrop>
      <Button variant="ghost" size="sm" className="friendly__back" onClick={onBack}>
        ← Início
      </Button>

      <header className="friendly__header">
        <span className="eyebrow">Amistoso</span>
        <h1 className="friendly__title">Monte os dois times</h1>
        <p className="friendly__lead">Escolha os clubes, escale as duas equipes com a tática que quiser e simule — nada é salvo.</p>
      </header>

      <div className="friendly__columns">
        <FriendlySide
          idPrefix="friendly-home"
          label="Mandante"
          side={home}
          otherClubId={away.clubId}
          clubs={clubs}
          squad={homeSquad}
          status={homeStatus}
          onPickClub={(clubId) => pickClub('home', clubId)}
          onFormationChange={(formation) => setHome((s) => ({ ...s, formation }))}
          onStyleChange={(style) => setHome((s) => ({ ...s, style }))}
          onAssignmentsChange={(assignments) => setHome((s) => ({ ...s, assignments }))}
        />
        <FriendlySide
          idPrefix="friendly-away"
          label="Visitante"
          side={away}
          otherClubId={home.clubId}
          clubs={clubs}
          squad={awaySquad}
          status={awayStatus}
          onPickClub={(clubId) => pickClub('away', clubId)}
          onFormationChange={(formation) => setAway((s) => ({ ...s, formation }))}
          onStyleChange={(style) => setAway((s) => ({ ...s, style }))}
          onAssignmentsChange={(assignments) => setAway((s) => ({ ...s, assignments }))}
        />
      </div>

      <Button variant="primary" block disabled={!canSimulate} onClick={runSimulation}>
        Simular partida
      </Button>
    </Backdrop>
  );
}
