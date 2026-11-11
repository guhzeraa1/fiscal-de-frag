import { randomInt } from 'node:crypto';

const jokes = {
  top: ['A fila era em equipe. O expediente foi solo.', 'Bateu a meta e pediu hora extra.', 'O mouse pediu adicional de insalubridade.'],
  middle: ['O contrato previa apoio moral.', 'Fez o possível com a call que recebeu.', 'Jogou o fino em horários alternados.', 'O highlight está em análise no VAR.'],
  bottom: ['Guardou os abates pra próxima.', 'Na hora do frag, optou por delegar.', 'O placar não mede presença de espírito.'],
};

const escapeDiscord = (value) => String(value).replace(/[\\*_~`|<>@]/g, '\\$&');

export function summarizeMatch({ map, teams }, playerId = '7618') {
  const team = teams.find(({ players }) => players.some(({ id }) => String(id) === playerId));
  if (!team) throw new Error('Seu perfil não está no placar.');
  if (team.players.length !== 5 || team.players.some(({ kills }) => !Number.isInteger(kills) || kills < 0)) {
    throw new Error('O placar do seu time está incompleto.');
  }

  const players = [...team.players].sort((a, b) => b.kills - a.kills);
  const remaining = Object.fromEntries(Object.entries(jokes).map(([key, values]) => [key, [...values]]));
  let position = 1;
  const lines = players.map(({ name, kills }, index) => {
    if (index > 0 && kills !== players[index - 1].kills) position = index + 1;
    const isTop = kills === players[0].kills;
    const isBottom = kills === players.at(-1).kills;
    const emoji = isTop && isBottom ? '🤝 ' : isTop ? '🏆 ' : isBottom ? '🪦 ' : '';
    const pool = remaining[isTop === isBottom ? 'middle' : isTop ? 'top' : 'bottom'];
    const joke = pool.length ? pool.splice(randomInt(pool.length), 1)[0] : 'Empate até na resenha.';
    return `${emoji}**${position}º ${escapeDiscord(name)} — ${kills} kills** · ${joke}`;
  });
  const opponent = teams.find((entry) => entry !== team);
  return [`📋 **Fiscal de Frag • ${escapeDiscord(map)} | ${team.score}–${opponent.score}**`, '', ...lines].join('\n');
}
