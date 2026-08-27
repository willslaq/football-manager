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

/**
 * clubId -> escudo. Mapeamento explícito porque os nomes de arquivo do pacote
 * de escudos original são inconsistentes e alguns têm erros de digitação
 * (ex.: "miirassol_sp.png" para Mirassol, "flarj.png"/"flurj.png" para
 * Flamengo/Fluminense) — não dá pra derivar o caminho a partir do clubId.
 * Conferido visualmente um a um contra o clube real antes de mapear.
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
};
