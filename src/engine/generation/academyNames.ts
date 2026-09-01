// Gera nomes fictícios pra promessas da categoria de base (ver academy.ts) sem precisar de um
// banco de nomes dedicado: reaproveita os nomes reais já embutidos nos dados do Brasileirão
// (src/data/brasileirao-2026 e -serie-b-2026), recombinando primeiro nome + sobrenome — mesmo
// estilo (incluindo jogadores conhecidos por um nome só, comum no futebol brasileiro).

import type { RNG } from '../rng';
import { pick, roll } from '../rng';
import type { RawClubFile } from './rawData';

const EXCLUDED_FILES = ['competition.json', 'fixtures.json', 'standings-current.json'];

const clubModulesA = import.meta.glob<{ default: RawClubFile }>('../../data/brasileirao-2026/*.json', { eager: true });
const clubModulesB = import.meta.glob<{ default: RawClubFile }>('../../data/brasileirao-serie-b-2026/*.json', {
  eager: true,
});

function collectRealNames(modules: Record<string, { default: RawClubFile }>): string[] {
  return Object.entries(modules)
    .filter(([path]) => !EXCLUDED_FILES.some((excluded) => path.endsWith(excluded)))
    .flatMap(([, mod]) => mod.default.squad.map((p) => p.name))
    .filter((name): name is string => !!name);
}

const REAL_NAMES = [...collectRealNames(clubModulesA), ...collectRealNames(clubModulesB)];
const NAME_TOKENS = REAL_NAMES.map((name) => name.trim().split(/\s+/));
const FIRST_NAMES = NAME_TOKENS.map((tokens) => tokens[0]);
const LAST_NAMES = NAME_TOKENS.filter((tokens) => tokens.length > 1).map((tokens) => tokens[tokens.length - 1]);

/** Chance de combinar com um sobrenome — o resto sai só com um nome, como vários jogadores reais do dataset-fonte. */
const SURNAME_CHANCE_PERCENT = 70;

/** Nome fictício de uma promessa da base, determinístico pro `rng` recebido (mesmo padrão de `generatePlayerDerived`). */
export function randomAcademyPlayerName(rng: RNG): string {
  const first = pick(rng, FIRST_NAMES);
  if (LAST_NAMES.length === 0 || roll(rng, 0, 99) >= SURNAME_CHANCE_PERCENT) return first;
  const last = pick(rng, LAST_NAMES);
  return last === first ? first : `${first} ${last}`;
}
