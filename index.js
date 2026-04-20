const express = require('express');
const puppeteer = require('puppeteer');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const API_KEY = '173ccbfe38f3eab27df1071001d477e7';
const PORT = process.env.PORT || 10000;

const app = express();

// ===== VARIÁVEIS =====
let currentQr = null;
let botStatus = 'iniciando';
let cacheJogos = [];
let cacheLive = [];
let ultimoCacheJogos = 0;
let ultimoCacheLive = 0;

const usuarios = new Set();
const cooldown = new Set();

// ===== CLIENT WHATSAPP =====
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'botwhatsappmike',
        dataPath: '.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ===== FUNÇÕES =====

function isGroupMessage(msg) {
    return msg.from.endsWith('@g.us');
}

function startCooldown(user, ms = 4000) {
    cooldown.add(user);
    setTimeout(() => cooldown.delete(user), ms);
}

function formatDateBR(dateString) {
    const data = new Date(dateString);
    return data.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function filterFutureGames(jogos) {
    const agora = new Date();
    return jogos.filter(j => new Date(j.fixture.date) > agora);
}

// ===== API JOGOS =====
async function getJogos() {
    const agora = Date.now();

    if (agora - ultimoCacheJogos < 60000 && cacheJogos.length > 0) {
        return cacheJogos;
    }

    try {
        let res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            headers: { 'x-apisports-key': API_KEY },
            params: { next: 50 }
        });

        let jogos = filterFutureGames(res.data.response || []);

        if (!jogos.length) {
            const hoje = new Date();
            const daqui7 = new Date();
            daqui7.setDate(hoje.getDate() + 7);

            res = await axios.get('https://v3.football.api-sports.io/fixtures', {
                headers: { 'x-apisports-key': API_KEY },
                params: {
                    from: hoje.toISOString().split('T')[0],
                    to: daqui7.toISOString().split('T')[0]
                }
            });

            jogos = filterFutureGames(res.data.response || []);
        }

        cacheJogos = jogos;
        ultimoCacheJogos = agora;

        return jogos;

    } catch (err) {
        console.log('ERRO JOGOS:', err.message);
        return cacheJogos;
    }
}

// ===== API AO VIVO =====
async function getLive() {
    const agora = Date.now();

    if (agora - ultimoCacheLive < 30000 && cacheLive.length > 0) {
        return cacheLive;
    }

    try {
        const res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            headers: { 'x-apisports-key': API_KEY },
            params: { live: 'all' }
        });

        cacheLive = res.data.response || [];
        ultimoCacheLive = agora;

        return cacheLive;

    } catch (err) {
        console.log('ERRO LIVE:', err.message);
        return cacheLive;
    }
}

// ===== EVENTOS =====

client.on('qr', qr => {
    currentQr = qr;
    botStatus = 'aguardando_qr';

    qrcode.generate(qr, { small: true });

    console.log('====== QR GERADO ======');
});

client.on('ready', () => {
    currentQr = null;
    botStatus = 'conectado';
    console.log('✅ BOT CONECTADO');
});

client.on('disconnected', () => {
    botStatus = 'desconectado';
});

// ===== MENSAGENS =====

client.on('message', async msg => {
    try {
        if (!isGroupMessage(msg)) return;

        const user = msg.author || msg.from;
        const text = msg.body.toLowerCase().trim();

        // BOAS VINDAS
        if (!usuarios.has(user)) {
            usuarios.add(user);

            await msg.reply(
`🚨 *LEIA PARA NÃO SER REMOVIDO!* 🚨

🏆 Champions Bet Club

1️⃣ Crie sua conta:
https://81gg6.com/?pid=4840583013

2️⃣ Faça depósito mínimo
3️⃣ Envie seu ID

🎁 BENEFÍCIOS:
💰 Cashback
🎟 Sorteios
📈 Tips

📌 COMANDOS:
!menu
!jogos
!tips
!placar
!banca`
            );
        }

        if (cooldown.has(user)) return;

        // MENU
        if (text === '!menu') {
            startCooldown(user);
            return msg.reply(
`📋 MENU

!jogos 📅
!tips 🔥
!placar 📊
!banca 💰`
            );
        }

        // JOGOS
        if (text === '!jogos') {
            startCooldown(user);

            const jogos = await getJogos();

            if (!jogos.length) {
                return msg.reply('⚠️ Buscando jogos... tente novamente.');
            }

            let resposta = '📅 *PRÓXIMOS JOGOS*\n\n';

            jogos.slice(0, 10).forEach(j => {
                resposta += `⚽ ${j.teams.home.name} x ${j.teams.away.name}\n`;
                resposta += `🕒 ${formatDateBR(j.fixture.date)}\n\n`;
            });

            return msg.reply(resposta);
        }

        // TIPS
        if (text === '!tips') {
            startCooldown(user);

            const jogos = await getJogos();

            if (!jogos.length) {
                return msg.reply('⚠️ Aguarde carregamento...');
            }

            const j = jogos[Math.floor(Math.random() * jogos.length)];

            return msg.reply(
`🔥 TIP DO DIA

⚽ ${j.teams.home.name} x ${j.teams.away.name}
🕒 ${formatDateBR(j.fixture.date)}

📊 Mais de 1.5 gols`
            );
        }

        // PLACAR
        if (text === '!placar') {
            startCooldown(user);

            const jogos = await getLive();

            if (!jogos.length) {
                return msg.reply('⚠️ Nenhum jogo ao vivo.');
            }

            let resposta = '🔴 AO VIVO\n\n';

            jogos.slice(0, 10).forEach(j => {
                resposta += `⚽ ${j.teams.home.name} ${j.goals.home} x ${j.goals.away} ${j.teams.away.name}\n`;
                resposta += `⏱ ${j.fixture.status.elapsed || 0}'\n\n`;
            });

            return msg.reply(resposta);
        }

        // BANCA
        if (text === '!banca') {
            startCooldown(user);

            return msg.reply(
`💰 GESTÃO

✔️ 2% por entrada
✔️ Nunca all-in
✔️ Longo prazo`
            );
        }

    } catch (err) {
        console.log('ERRO MSG:', err.message);
    }
});

// ===== WEB =====

app.get('/', (req, res) => {
    res.send(`Status: ${botStatus}`);
});

app.get('/qr', (req, res) => {
    if (!currentQr) return res.send('QR ainda não disponível');

    res.send(`
    <html>
    <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#000">
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${currentQr}">
    </body>
    </html>
    `);
});

app.listen(PORT, () => {
    console.log('WEB OK');
});

// ===== START =====
client.initialize();