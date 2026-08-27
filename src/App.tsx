import { useEffect, useState } from 'react';
import { useCareerStore } from './store/careerStore';
import { Start } from './ui/screens/Start';
import { NewCareer } from './ui/screens/NewCareer';
import { Home } from './ui/screens/Home';
import { Squad } from './ui/screens/Squad';
import { Lineup } from './ui/screens/Lineup';
import { Table } from './ui/screens/Table';
import { MatchResult } from './ui/screens/MatchResult';
import { AppShell, type HubScreen } from './ui/components';
import { CLUB_CRESTS } from './ui/clubCrests';
import { findClub } from './ui/utils';

export type Screen = HubScreen | 'matchResult';
type PreCareerScreen = 'start' | 'newCareer';

function App() {
  const career = useCareerStore((s) => s.career);
  const lastMatch = useCareerStore((s) => s.lastMatch);
  const [screen, setScreen] = useState<Screen>('home');
  const [preCareerScreen, setPreCareerScreen] = useState<PreCareerScreen>('start');

  useEffect(() => {
    if (lastMatch) setScreen('matchResult');
  }, [lastMatch]);

  if (!career) {
    if (preCareerScreen === 'newCareer') return <NewCareer onBack={() => setPreCareerScreen('start')} />;
    return <Start onNewCareer={() => setPreCareerScreen('newCareer')} />;
  }

  if (screen === 'matchResult') {
    return <MatchResult onNavigate={setScreen} />;
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
      {screen === 'table' && <Table />}
      {screen === 'home' && <Home onNavigate={setScreen} />}
    </AppShell>
  );
}

export default App;
