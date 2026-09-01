import athleticoPr from '../assets/escudos/atleticopr_bra.png';
import atleticoMg from '../assets/escudos/atleticomg_bra.png';
import bahia from '../assets/escudos/bahia.png';
import botafogo from '../assets/escudos/botafogorj_bra.png';
import bragantino from '../assets/escudos/bragantino_bra.png';
import chapecoense from '../assets/escudos/chapecoense_bra.png';
import corinthians from '../assets/escudos/corinthians_bra.png';
import coritiba from '../assets/escudos/coritiba_bra.png';
import cruzeiro from '../assets/escudos/cruzeiro_bra.png';
import flamengo from '../assets/escudos/flarj.png';
import fluminense from '../assets/escudos/flurj.png';
import gremio from '../assets/escudos/gremio.png';
import internacional from '../assets/escudos/internacional_bra.png';
import mirassol from '../assets/escudos/miirassol_sp.png';
import palmeiras from '../assets/escudos/palmeiras.png';
import remo from '../assets/escudos/remo.png';
import santos from '../assets/escudos/santos.png';
import saoPaulo from '../assets/escudos/saopaulo_bra.png';
import vasco from '../assets/escudos/vasco.png';
import vitoria from '../assets/escudos/vitoria.png';

// Série B
import americaMg from '../assets/escudos/americamg_bra.png';
import athletic from '../assets/escudos/athleticclub_mg.png';
import atleticoGo from '../assets/escudos/atleticogo_bra.png';
import avai from '../assets/escudos/avai_bra.png';
import botafogoSp from '../assets/escudos/botafogosp_bra.png';
import ceara from '../assets/escudos/ceara_bra.png';
import crb from '../assets/escudos/crb_bra.png';
import criciuma from '../assets/escudos/criciuma_bra.png';
import cuiaba from '../assets/escudos/cuiaba_bra.png';
import fortaleza from '../assets/escudos/fortaleza.png';
import goias from '../assets/escudos/goias.png';
import juventude from '../assets/escudos/juventude.png';
import londrina from '../assets/escudos/londrina_pr.png';
import nautico from '../assets/escudos/nautico.png';
import novorizontino from '../assets/escudos/novorinzontino_sp.png';
import operarioPr from '../assets/escudos/operario_pr.png';
import pontePreta from '../assets/escudos/pontepreta_bra.png';
import saoBernardo from '../assets/escudos/saobernardo_sp.png';
import sport from '../assets/escudos/sport.png';
import vilaNova from '../assets/escudos/vilago.png';

/**
 * clubId -> escudo. Mapeamento explícito porque os nomes de arquivo do pacote
 * de escudos original são inconsistentes e alguns têm erros de digitação
 * (ex.: "miirassol_sp.png" para Mirassol, "flarj.png"/"flurj.png" para
 * Flamengo/Fluminense, "novorinzontino_sp.png" para Novorizontino) — não dá
 * pra derivar o caminho a partir do clubId. Conferido visualmente um a um
 * contra o clube real antes de mapear (ver [[project_serie_b_dual_division]]
 * pra "vilago.png" = Vila Nova-GO, não confundir com "villanovamg.png",
 * clube diferente do mesmo nome em MG).
 */
export const CLUB_CRESTS: Record<string, string> = {
  'athletico-pr': athleticoPr,
  'atletico-mg': atleticoMg,
  bahia,
  botafogo,
  bragantino,
  chapecoense,
  corinthians,
  coritiba,
  cruzeiro,
  flamengo,
  fluminense,
  gremio,
  internacional,
  mirassol,
  palmeiras,
  remo,
  santos,
  'sao-paulo': saoPaulo,
  vasco,
  vitoria,

  // Série B
  'america-mg': americaMg,
  athletic,
  'atletico-go': atleticoGo,
  avai,
  'botafogo-sp': botafogoSp,
  ceara,
  crb,
  criciuma,
  cuiaba,
  fortaleza,
  goias,
  juventude,
  londrina,
  nautico,
  novorizontino,
  'operario-pr': operarioPr,
  'ponte-preta': pontePreta,
  'sao-bernardo': saoBernardo,
  sport,
  'vila-nova': vilaNova,
};
