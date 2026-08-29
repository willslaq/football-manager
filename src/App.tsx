import { useEffect, useState } from 'react';
import { useCareerStore } from './store/careerStore';
import { Start } from './ui/screens/Start';
import { NewCareer } from './ui/screens/NewCareer';
import { Home } from './ui/screens/Home';
import { Squad } from './ui/screens/Squad';
import { Lineup } from './ui/screens/Lineup';
import { Calendar } from './ui/screens/Calendar';
import { Table } from './ui/screens/Table';
import { Settings } from './ui/screens/Settings';
import { MatchLive } from './ui/screens/MatchLive';
import { MatchResult } from './ui/screens/MatchResult';
import { MatchHistory } from './ui/screens/MatchHistory';
import { AppShell, type HubScreen } from './ui/components';
import { CLUB_CRESTS } from './ui/clubCrests';
import { findClub } from './ui/utils';
import type { MatchResult as MatchResultData } from './engine/types';

export type Screen = HubScreen | 'matchLive' | 'matchResult' | 'matchHistory';
type PreCareerScreen = 'start' | 'newCareer';

function App() {
  const career = useCareerStore((s) => s.career);
  const lastMatch = useCareerStore((s) => s.lastMatch);
  const liveMatch = useCareerStore((s) => s.liveMatch);
  const [screen, setScreen] = useState<Screen>('home');
  const [preCareerScreen, setPreCareerScreen] = useState<PreCareerScreen>('start');
  const [historyMatch, setHistoryMatch] = useState<MatchResultData | null>(null);

  useEffect(() => {
    if (liveMatch) setScreen('matchLive');
  }, [liveMatch]);

  useEffect(() => {
    if (lastMatch) {
      setHistoryMatch(null);
      setScreen('matchResult');
    }
  }, [lastMatch]);

  if (!career) {
    if (preCareerScreen === 'newCareer') return <NewCareer onBack={() => setPreCareerScreen('start')} />;
    return <Start onNewCareer={() => setPreCareerScreen('newCareer')} />;
  }

  if (screen === 'matchLive') {
    return <MatchLive />;
  }

  if (screen === 'matchHistory') {
    return (
      <MatchHistory
        onSelect={(result) => {
          setHistoryMatch(result);
          setScreen('matchResult');
        }}
        onBack={() => setScreen('table')}
      />
    );
  }

  if (screen === 'matchResult') {
    return (
      <MatchResult
        result={historyMatch ?? undefined}
        onNavigate={(next) => {
          setHistoryMatch(null);
          setScreen(next);
        }}
      />
    );
  }

  const club = findClub(career, career.playerClubId);
  const competition = career.season.competitions[0];
  const totalRounds = competition.fixtures.length;
  const roundLabel =
    career.season.state === 'finished'
      ? 'Temporada encerrada'
      : `Rodada ${career.season.currentRound}/${totalRounds}`;

  return (
    <AppShell
      active={screen}
      onNavigate={setScreen}
      clubName={club?.name ?? career.playerClubId}
      clubCrest={club ? CLUB_CRESTS[club.id] : undefined}
      roundLabel={roundLabel}
    >
      {screen === 'squad' && <Squad />}
      {screen === 'lineup' && <Lineup />}
      {screen === 'calendar' && (
        <Calendar
          onSelect={(result) => {
            setHistoryMatch(result);
            setScreen('matchResult');
          }}
        />
      )}
      {screen === 'table' && <Table onNavigate={setScreen} />}
      {screen === 'home' && <Home onNavigate={setScreen} />}
      {screen === 'settings' && <Settings />}
    </AppShell>
  );
}

export default App;
