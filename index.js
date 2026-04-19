const express = require("express");
const axios = require("axios");
const moment = require("moment-timezone");
const pino = require("pino");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

// ================= CONFIG =================
const API_KEY = "123";
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const TIMEZONE = "America/Sao_Paulo";
const PORT = process.env.PORT || 10000;

// ================= ESTADO QR =================
let currentQR = null;
let currentQRDataURL = null;
let isConnected = false;

// ================= WEB SERVER =================
const app = express();

app.get("/", (req, res) => {
  res.send("Bot rodando.");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/qr", async (req, res) => {
  try {
    if (isConnected) {
      return res.send(`
        <html>
          <head><meta charset="utf-8"><title>QR do Bot</title></head>
          <body style="font-family:Arial;text-align:center;padding:40px;background:#111;color:#fff;">
            <h1>✅ Bot conectado</h1>
            <p>O WhatsApp já foi autenticado.</p>
          </body>
        </html>
      `);
    }

    if (!currentQR) {
      return res.send(`
        <html>
          <head><meta charset="utf-8"><title>QR do Bot</title></head>
          <body style="font-family:Arial;text-align:center;padding:40px;background:#111;color:#fff;">
            <h1>⏳ QR ainda não disponível</h1>
            <p>Atualize esta página em alguns segundos.</p>
          </body>
        </html>
      `);
    }

    if (!currentQRDataURL) {
      currentQRDataURL = await QRCode.toDataURL(currentQR, {
        width: 360,
        margin: 2
      });
    }

    return res.send(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>QR do Bot</title>
        </head>
        <body style="font-family:Arial;text-align:center;padding:40px;background:#111;color:#fff;">
          <h1>📱 Escaneie o QR Code</h1>
          <p>WhatsApp > Dispositivos conectados > Conectar dispositivo</p>
          <img src="${currentQRDataURL}" style="background:#fff;padding:16px;border-radius:12px;" />
          <p style="margin-top:20px;">Se expirar, atualize a página.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("[QR_ROUTE_ERROR]", error);
    res.status(500).send("Erro ao gerar QR.");
  }
});

app.listen(PORT, () => {
  console.log(`[WEB] Servidor ouvindo na porta ${PORT}`);
});

// ================= HELPERS =================
function log(tipo, msg) {
  const hora = moment().tz(TIMEZONE).format("DD/MM HH:mm:ss");
  console.log(`[${hora}] [${tipo}] ${msg}`);
}

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

// ================= BOT =================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Render Bot", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      currentQRDataURL = null;
      isConnected = false;

      console.log("\n====== QR CODE GERADO ======\n");
      console.log("Abra no navegador:");
      console.log(`https://botwhatsappmike-1.onrender.com/qr`);
      console.log("\n============================\n");
    }

    if (connection === "open") {
      isConnected = true;
      currentQR = null;
      currentQRDataURL = null;
      log("BOT", "✅ Bot conectado!");
    }

    if (connection === "close") {
      isConnected = false;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      log("BOT", `Conexão fechada. Reconectar: ${shouldReconnect}`);

      if (shouldReconnect) {
        startBot();
      } else {
        log("BOT", "Sessão deslogada. Será necessário novo QR.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const msg = messages[0];
    if (!msg.message) return;
    if (!msg.key.remoteJid || !msg.key.remoteJid.endsWith("@g.us")) return;
    if (msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const body = text.toLowerCase().trim();

    log("MSG", body);

    if (body === "!menu") {
      await sock.sendMessage(msg.key.remoteJid, {
        text: `📋 MENU

!jogos 📅
!tips 🔥
!placar 📊
!banca 💰`
      });
      return;
    }

    if (body === "!jogos") {
      const jogos = await getJogos();

      if (!jogos.length) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "⚠️ Nenhum jogo hoje"
        });
        return;
      }

      let txt = "📅 JOGOS HOJE\n\n";

      jogos.slice(0, 10).forEach((j) => {
        txt += `⚽ ${j.strHomeTeam} x ${j.strAwayTeam}\n`;
        txt += `🏆 ${j.strLeague}\n`;
        txt += `🕒 ${formatarData(j.dateEvent, j.strTime)}\n\n`;
      });

      await sock.sendMessage(msg.key.remoteJid, { text: txt });
      return;
    }

    if (body === "!tips") {
      const jogos = await getJogos();

      if (!jogos.length) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "⚠️ Sem jogos hoje"
        });
        return;
      }

      let txt = "🔥 TIPS DO DIA\n\n";

      jogos.slice(0, 5).forEach((j, i) => {
        txt += `⚽ ${j.strHomeTeam} x ${j.strAwayTeam}\n`;
        txt += `🎯 ${pickTip(i)}\n\n`;
      });

      await sock.sendMessage(msg.key.remoteJid, { text: txt });
      return;
    }

    if (body === "!placar") {
      const jogos = await getJogos();

      if (!jogos.length) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "⚠️ Nenhum placar disponível"
        });
        return;
      }

      let txt = "🔴 PLACAR\n\n";

      jogos.slice(0, 10).forEach((j) => {
        txt += `⚽ ${j.strHomeTeam} ${j.intHomeScore || 0} x ${j.intAwayScore || 0} ${j.strAwayTeam}\n`;
      });

      await sock.sendMessage(msg.key.remoteJid, { text: txt });
      return;
    }

    if (body === "!banca") {
      await sock.sendMessage(msg.key.remoteJid, {
        text: `💰 GESTÃO DE BANCA

✔️ 2% a 5%
✔️ sem emoção
✔️ longo prazo`
      });
    }
  });
}

startBot().catch((err) => {
  console.error("[FATAL]", err);
});