const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const moment = require("moment-timezone");

// =========================
// CONFIG
// =========================
const API_KEY = "123";
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const TIMEZONE = "America/Sao_Paulo";

const COOLDOWN_MS = 15000;
const JOGOS_CACHE_MS = 15 * 60 * 1000; // 15 min
const PLACAR_CACHE_MS = 2 * 60 * 1000; // 2 min

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// =========================
// CONTROLE
// =========================
const usuarios = new Set();
const cooldown = new Set();
const processed = new Set();

let jogosCache = null;
let jogosCacheTimestamp = 0;

let placarCache = null;
let placarCacheTimestamp = 0;

// =========================
// LOG
// =========================
function log(tipo, mensagem, extra = null) {
  const agora = moment().tz(TIMEZONE).format("DD/MM/YYYY HH:mm:ss");
  console.log(`[${agora}] [${tipo}] ${mensagem}`);
  if (extra) {
    try {
      console.log(JSON.stringify(extra, null, 2));
    } catch {
      console.log(extra);
    }
  }
}

process.on("unhandledRejection", (err) => {
  log("ERRO", "UnhandledRejection", err);
});

process.on("uncaughtException", (err) => {
  log("ERRO", "UncaughtException", err);
});

// =========================
// AXIOS
// =========================
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  log("API", `${config.method?.toUpperCase()} ${config.baseURL}${config.url}`, config.params || {});
  return config;
});

api.interceptors.response.use(
  (response) => {
    log("API", `Resposta ${response.status} em ${response.config.url}`);
    return response;
  },
  (error) => {
    log("ERRO API", error.message, error.response?.data || null);
    return Promise.reject(error);
  }
);

// =========================
// HELPERS
// =========================
function aplicarCooldown(user) {
  cooldown.add(user);
  setTimeout(() => {
    cooldown.delete(user);
    log("COOLDOWN", `Cooldown removido para ${user}`);
  }, COOLDOWN_MS);
}

function msgBoasVindas() {
  return `🚨 LEIA PARA NÃO SER REMOVIDO 🚨

🏆 Champions Bet Club

1️⃣ Criar conta:
https://81gg6.com/?pid=4840583013

2️⃣ Depósito mínimo R$10,00
3️⃣ Enviar ID

💰 Cashback
🎟 Sorteios
📈 Tips exclusivas

📌 COMANDOS:
!menu`;
}

function formatarData(data, hora) {
  if (!data && !hora) return "Horário indisponível";

  // TheSportsDB costuma vir com dateEvent e strTime em UTC
  if (data && hora) {
    const m = moment.utc(`${data} ${hora}`, "YYYY-MM-DD HH:mm:ss").tz(TIMEZONE);
    if (m.isValid()) return m.format("DD/MM HH:mm");
  }

  if (data) {
    const m = moment(data);
    if (m.isValid()) return m.format("DD/MM");
  }

  return hora || "Horário indisponível";
}

function getHome(evento) {
  return evento?.strHomeTeam || "Mandante";
}

function getAway(evento) {
  return evento?.strAwayTeam || "Visitante";
}

function getLeague(evento) {
  return evento?.strLeague || "Liga";
}

function getScoreHome(evento) {
  return evento?.intHomeScore ?? "-";
}

function getScoreAway(evento) {
  return evento?.intAwayScore ?? "-";
}

function isSoccerEvent(evento) {
  return String(evento?.strSport || "").toLowerCase() === "soccer";
}

function filtrarEventosValidos(eventos) {
  return (eventos || []).filter((e) => isSoccerEvent(e) && e?.strHomeTeam && e?.strAwayTeam);
}

function pickTip(index) {
  const opcoes = [
    "📊 Mais de 1.5 gols",
    "📊 Mais de 2.5 gols",
    "📊 Ambas Marcam: SIM",
    "📊 Ambas Marcam: NÃO",
    "📊 Dupla Chance 1X",
    "📊 Dupla Chance X2",
    "📊 Casa marca +0.5 gols",
    "📊 Fora marca +0.5 gols",
    "📊 Under 3.5 gols",
    "📊 Over 0.5 HT",
  ];
  return opcoes[index % opcoes.length];
}

// =========================
// BUSCAR JOGOS
// =========================
async function buscarEventosPorDia(data) {
  const res = await api.get("/eventsday.php", {
    params: {
      d: data,
      s: "Soccer",
    },
  });

  return filtrarEventosValidos(res.data?.events || []);
}

async function getJogos() {
  if (jogosCache && Date.now() - jogosCacheTimestamp < JOGOS_CACHE_MS) {
    log("CACHE", "Retornando jogos do cache");
    return jogosCache;
  }

  try {
    const hoje = moment().tz(TIMEZONE).format("YYYY-MM-DD");
    const amanha = moment().tz(TIMEZONE).add(1, "day").format("YYYY-MM-DD");
    const depois = moment().tz(TIMEZONE).add(2, "day").format("YYYY-MM-DD");

    log("JOGOS", `Buscando eventos de ${hoje}, ${amanha} e ${depois}`);

    const [j1, j2, j3] = await Promise.all([
      buscarEventosPorDia(hoje),
      buscarEventosPorDia(amanha),
      buscarEventosPorDia(depois),
    ]);

    const todos = [...j1, ...j2, ...j3];

    const mapa = new Map();
    for (const e of todos) {
      mapa.set(e.idEvent, e);
    }

    const jogos = Array.from(mapa.values()).sort((a, b) => {
      const ma = moment.utc(`${a.dateEvent || ""} ${a.strTime || "00:00:00"}`, "YYYY-MM-DD HH:mm:ss");
      const mb = moment.utc(`${b.dateEvent || ""} ${b.strTime || "00:00:00"}`, "YYYY-MM-DD HH:mm:ss");
      return ma.valueOf() - mb.valueOf();
    });

    jogosCache = jogos;
    jogosCacheTimestamp = Date.now();

    log("JOGOS", `Total final: ${jogos.length} jogo(s)`);
    return jogos;
  } catch (err) {
    log("ERRO", "Falha ao buscar jogos", err.message);
    return [];
  }
}

// =========================
// BUSCAR PLACAR
// =========================
async function getPlacar() {
  if (placarCache && Date.now() - placarCacheTimestamp < PLACAR_CACHE_MS) {
    log("CACHE", "Retornando placar do cache");
    return placarCache;
  }

  try {
    const hoje = moment().tz(TIMEZONE).format("YYYY-MM-DD");
    log("PLACAR", `Buscando eventos do dia ${hoje}`);

    const eventos = await buscarEventosPorDia(hoje);

    // mostra jogos que já têm algum placar ou status
    const jogos = eventos.filter((e) => {
      return (
        e.intHomeScore !== null ||
        e.intAwayScore !== null ||
        e.strStatus ||
        e.strProgress
      );
    });

    placarCache = jogos;
    placarCacheTimestamp = Date.now();

    log("PLACAR", `Total final: ${jogos.length} jogo(s)`);
    return jogos;
  } catch (err) {
    log("ERRO", "Falha ao buscar placar", err.message);
    return [];
  }
}

// =========================
// EVENTOS WHATSAPP
// =========================
client.on("qr", (qr) => {
  log("BOT", "QR gerado");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  log("BOT", "✅ Bot conectado!");
});

client.on("authenticated", () => {
  log("BOT", "Sessão autenticada");
});

client.on("auth_failure", (msg) => {
  log("ERRO", "Falha de autenticação", msg);
});

client.on("disconnected", (reason) => {
  log("ERRO", "Bot desconectado", reason);
});

client.on("group_join", async (notification) => {
  try {
    const chat = await notification.getChat();
    const contato = await notification.getContact();
    const user = contato.id._serialized;

    if (usuarios.has(user)) return;
    usuarios.add(user);

    await client.sendMessage(chat.id._serialized, msgBoasVindas());
    log("WELCOME", `Boas-vindas enviadas para ${user}`);
  } catch (err) {
    log("ERRO", "Falha no group_join", err.message);
  }
});

client.on("message", async (msg) => {
  try {
    const msgId = msg.id._serialized;
    if (processed.has(msgId)) return;
    processed.add(msgId);
    setTimeout(() => processed.delete(msgId), 60000);

    if (!msg.from.endsWith("@g.us")) return;

    const user = msg.author || msg.from;
    const text = (msg.body || "").toLowerCase().trim();

    log("MSG", `${user} -> ${text}`);

    if (
      !usuarios.has(user) &&
      !["!menu", "!jogos", "!tips", "!placar", "!banca"].includes(text)
    ) {
      usuarios.add(user);
      await msg.reply(msgBoasVindas());
      return;
    }

    if (cooldown.has(user)) {
      await msg.reply("⏳ Aguarde 15 segundos para enviar outra mensagem.");
      return;
    }

    if (text === "!menu") {
      aplicarCooldown(user);
      await msg.reply(`📋 MENU

!jogos 📅
!tips 🔥
!placar 📊
!banca 💰`);
      return;
    }

    if (text === "!jogos") {
      aplicarCooldown(user);

      const jogos = await getJogos();

      if (!jogos.length) {
        await msg.reply("⚠️ Nenhum jogo encontrado no momento.");
        return;
      }

      let resposta = `📅 PRÓXIMOS JOGOS\n\n`;

      jogos.slice(0, 10).forEach((j) => {
        resposta += `⚽ ${getHome(j)} x ${getAway(j)}\n`;
        resposta += `🏆 ${getLeague(j)}\n`;
        resposta += `🕒 ${formatarData(j.dateEvent, j.strTime)}\n\n`;
      });

      await msg.reply(resposta);
      return;
    }

    if (text === "!tips") {
      aplicarCooldown(user);

      const jogos = await getJogos();

      if (!jogos.length) {
        await msg.reply("⚠️ Nenhum jogo disponível no momento.");
        return;
      }

      let resposta = `🔥 TIPS DO DIA\n\n`;

      jogos.slice(0, 8).forEach((j, i) => {
        resposta += `⚽ ${getHome(j)} x ${getAway(j)}\n`;
        resposta += `🏆 ${getLeague(j)}\n`;
        resposta += `🕒 ${formatarData(j.dateEvent, j.strTime)}\n`;
        resposta += `🎯 ${pickTip(i)}\n\n`;
      });

      await msg.reply(resposta);
      return;
    }

    if (text === "!placar") {
      aplicarCooldown(user);

      const jogos = await getPlacar();

      if (!jogos.length) {
        await msg.reply("⚠️ Nenhum placar disponível agora.");
        return;
      }

      let resposta = `🔴 PLACARES DO DIA\n\n`;

      jogos.slice(0, 10).forEach((j) => {
        resposta += `⚽ ${getHome(j)} ${getScoreHome(j)} x ${getScoreAway(j)} ${getAway(j)}\n`;
        resposta += `🏆 ${getLeague(j)}\n`;
        resposta += `⏱️ ${j.strStatus || j.strProgress || "Atualizando"}\n\n`;
      });

      await msg.reply(resposta);
      return;
    }

    if (text === "!banca") {
      aplicarCooldown(user);
      await msg.reply(`💰 GESTÃO DE BANCA

✔️ 2% a 5% por aposta
✔️ sem emoção
✔️ foco no longo prazo`);
      return;
    }
  } catch (err) {
    log("ERRO", "Erro no evento message", err);
    try {
      await msg.reply("⚠️ Ocorreu um erro no bot. Veja o CMD.");
    } catch {}
  }
});

log("BOT", "Iniciando...");
client.initialize();