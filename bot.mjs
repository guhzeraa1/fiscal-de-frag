import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { chromium } from 'playwright';
import { summarizeMatch } from './fiscal-de-frag.mjs';

const { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID } = process.env;
if (!DISCORD_BOT_TOKEN || !/^\d+$/.test(DISCORD_CHANNEL_ID ?? '')) {
  throw new Error('Configure DISCORD_BOT_TOKEN e DISCORD_CHANNEL_ID na hospedagem.');
}

const client = new Client({ intents: [
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
] });
const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
const channel = Routes.channelMessages(DISCORD_CHANNEL_ID);
const botId = (await rest.get(Routes.user('@me'))).id;
const recentWindow = 24 * 60 * 60 * 1000;
const matchLink = /(?:^|[\s<(])https:\/\/(?:www\.)?gamersclub\.com\.br\/lobby\/match\/(\d+)(?=$|[\s>?)#])/g;

async function readMatch(id) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`https://gamersclub.com.br/lobby/match/${id}`, { timeout: 20000, waitUntil: 'domcontentloaded' });
    await page.getByText('Finalizado', { exact: true }).first().waitFor({ timeout: 12000 });
    return await page.evaluate(() => {
      const teams = Array.from(document.querySelectorAll('table,[role="table"]')).flatMap((table) => {
        const rows = [...table.querySelectorAll('tr,[role="row"]')];
        const cells = (row) => [...row.querySelectorAll('th,td,[role="cell"],[role="columnheader"]')];
        const header = rows[0] ? cells(rows[0]) : [];
        const k = header.findIndex((cell) => cell.innerText.trim() === 'K');
        if (k < 1) return [];
        const score = Number(header[0].innerText.trim().match(/^\d+/)?.[0]);
        const players = rows.slice(1).flatMap((row) => {
          const profile = row.querySelector('a[href*="/player/"]');
          const id = profile?.getAttribute('href')?.match(/\/player\/(\d+)/)?.[1];
          const rowCells = cells(row);
          const detailsIndex = rowCells.findIndex((cell) => profile && cell.contains(profile));
          if (!id || detailsIndex !== 0) return [];
          // GC has a notes cell and a level cell before the K column.
          const rawKills = rowCells[k + 2]?.innerText.trim();
          if (!/^\d+$/.test(rawKills ?? '')) throw new Error('Coluna K indisponível.');
          const name = profile.innerText.trim() || profile.getAttribute('aria-label')
            || profile.querySelector('img[alt]')?.alt;
          if (!name) throw new Error('Nome de jogador indisponível.');
          return [{ id, name, kills: Number(rawKills) }];
        });
        return [{ score, players }];
      });
      const map = document.body.innerText.match(/\bde_([a-z0-9_]+)\b/i)?.[1];
      if (!map || teams.length !== 2 || teams.some(({ score, players }) => !Number.isInteger(score) || players.length !== 5)) {
        throw new Error('Placar incompleto.');
      }
      return { map: map[0].toUpperCase() + map.slice(1), teams };
    });
  } finally {
    await browser.close();
  }
}

async function recentMessages() {
  const messages = [];
  const cutoff = Date.now() - recentWindow;
  let before;
  while (true) {
    const query = new URLSearchParams({ limit: '100', ...(before && { before }) });
    const batch = await rest.get(channel, { query });
    messages.push(...batch);
    if (batch.length < 100 || Date.parse(batch.at(-1).timestamp) < cutoff) return messages;
    before = batch.at(-1).id;
  }
}

function wasPublished(messages, id) {
  return messages.some((message) => message.author.id === botId
    && message.content.endsWith(`\n-# Partida GC ${id}`));
}

async function processMessages(backup) {
  const messages = await recentMessages();
  const now = Date.now();
  const attempted = new Set();
  for (const message of messages.slice().reverse()) {
    const age = now - Date.parse(message.timestamp);
    if (message.author.bot || age > recentWindow || (backup && age < 120000)) continue;
    for (const [, id] of message.content.matchAll(matchLink)) {
      if (attempted.has(id) || wasPublished(messages, id)) continue;
      attempted.add(id);
      let result;
      try {
        result = summarizeMatch(await readMatch(id));
      } catch (error) {
        // An unfinished or unavailable match stays eligible for a later check.
        console.log('Partida aguardando leitura:', id, error instanceof Error ? error.message.split('\n')[0] : 'Falha no placar');
        continue;
      }
      if (wasPublished(await recentMessages(), id)) continue;
      const reply = await rest.post(channel, { body: {
        content: `${result}\n-# Partida GC ${id}`,
        message_reference: { message_id: message.id, fail_if_not_exists: true },
        allowed_mentions: { parse: [], replied_user: false },
        nonce: `gc-${id}`,
        enforce_nonce: true,
      } });
      messages.push(reply);
      console.log('Resumo publicado para a partida', id);
    }
  }
}

if (process.argv.includes('--backup')) {
  await processMessages(true);
} else {
  let busy = false;
  async function check() {
    if (busy) return;
    busy = true;
    try {
      await processMessages(false);
    } catch {
      console.error('Falha ao consultar ou responder no canal configurado.');
    } finally {
      busy = false;
    }
  }
  client.once('clientReady', () => {
    void check();
    setInterval(check, 60000);
  });
  client.on('messageCreate', (message) => {
    if (message.channelId === DISCORD_CHANNEL_ID && !message.author.bot) void check();
  });
  await client.login(DISCORD_BOT_TOKEN);
}
