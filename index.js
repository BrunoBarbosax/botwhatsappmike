const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");
const moment = require("moment-timezone");

// CONFIG
const API_KEY = "123";
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const TIMEZONE = "America/Sao_Paulo";

// CLIENT
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process"
    ]
  }
});

// LOG
function log(tipo, msg) {
  const hora = moment().tz(TIMEZONE).format("DD/MM HH:mm:ss");
  console.log(`[${hora}] [${tipo}] ${msg}`);
}

// ERROS
process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED_REJECTION]", err);
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT_EXCEPTION]", err);
});

// EVENTOS
client.on("qr", (qr) => {
  console.log("\n====== QR CODE ======\n");
  console.log(qr);
  console.log("\n=====================\n");
});

client.on("ready", () => {
  log("BOT", "✅ Bot conectado!");
});

client.on("auth_failure", (msg) => {
  log("ERRO", "Auth falhou: " + msg);
});

client.on("disconnected", (reason) => {
  log("ERRO", "Desconectado: " + reason);
});

client.on("loading_screen", (p, m) => {
  log("LOAD", `${p}% - ${m}`);
});

// HELPERS
function formatarData(data, hora) {
  if (!data || !hora) return "Sem horário";
  return moment.utc(`${data} ${hora}`)
    .tz(TIMEZONE)
    .format("DD/MM HH:mm");
}

function pickTip(i) {
  const tips = [
    "📊 Mais de 1.5 gols",
    "📊 Mais de 2.5 gols",
    "📊 Ambas marcam SIM",
    "📊 Dupla chance 1X",
    "📊 Over HT",
    "📊 Under 3.5"
  ];
  return tips[i % tips.length];
}

// API
async function getJogos() {
  try {
    const hoje = moment().format("YYYY-MM-DD");

    const res = await axios.get(`${BASE_URL}/eventsday.php`, {
      params: { d: hoje, s: "Soccer" }
    });

    return res.data.events || [];
  } catch (err) {
    log("ERRO", "Erro API jogos");
    return [];
  }
}

// BOT
client.on("message", async (msg) => {
  if (!msg.from.includes("@g.us")) return;

  const text = msg.body.toLowerCase();

  log("MSG", text);

  if (text === "!menu") {
    return msg.reply(`📋 MENU

!jogos 📅
!tips 🔥
!placar 📊
!banca 💰`);
  }

  if (text === "!jogos") {
    const jogos = await getJogos();

    if (!jogos.length) {
      return msg.reply("⚠️ Nenhum jogo hoje");
    }

    let txt = "📅 JOGOS HOJE\n\n";

    jogos.slice(0, 10).forEach(j => {
      txt += `⚽ ${j.strHomeTeam} x ${j.strAwayTeam}\n`;
      txt += `🏆 ${j.strLeague}\n`;
      txt += `🕒 ${formatarData(j.dateEvent, j.strTime)}\n\n`;
    });

    return msg.reply(txt);
  }

  if (text === "!tips") {
    const jogos = await getJogos();

    if (!jogos.length) {
      return msg.reply("⚠️ Sem jogos hoje");
    }

    let txt = "🔥 TIPS DO DIA\n\n";

    jogos.slice(0, 5).forEach((j, i) => {
      txt += `⚽ ${j.strHomeTeam} x ${j.strAwayTeam}\n`;
      txt += `🎯 ${pickTip(i)}\n\n`;
    });

    return msg.reply(txt);
  }

  if (text === "!placar") {
    const jogos = await getJogos();

    let txt = "🔴 PLACAR\n\n";

    jogos.slice(0, 10).forEach(j => {
      txt += `⚽ ${j.strHomeTeam} ${j.intHomeScore || 0} x ${j.intAwayScore || 0} ${j.strAwayTeam}\n`;
    });

    return msg.reply(txt);
  }

  if (text === "!banca") {
    return msg.reply(`💰 GESTÃO DE BANCA

✔️ 2% a 5%
✔️ sem emoção
✔️ longo prazo`);
  }
});

// START
log("BOT", "Iniciando...");
client.initialize();