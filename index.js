const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const API_KEY = '173ccbfe38f3eab27df1071001d477e7';
const PORT = process.env.PORT || 10000;

const app = express();

let currentQr = null;
let botStatus = 'iniciando';
let cacheJogos = [];
let cacheLive = [];
let ultimoCacheJogos = 0;
let ultimoCacheLive = 0;

const usuarios = new Set();
const cooldown = new Set();

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'botwhatsappmike',
        dataPath: '.wwebjs_auth'
    }),
    puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/render/.cache/puppeteer/chrome/linux-147.0.7727.56/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
}
});

function isGroupMessage(msg) {
    return typeof msg.from === 'string' && msg.from.endsWith('@g.us');
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
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function filterFutureGames(jogos) {
    const agora = new Date();
    return (jogos || []).filter(j => {
        try {
            return new Date(j.fixture.date) > agora;
        } catch {
            return false;
        }
    });
}

async function getJogos() {
    const agora = Date.now();

    if (agora - ultimoCacheJogos < 60000 && cacheJogos.length > 0) {
        return cacheJogos;
    }

    try {
        let res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            headers: { 'x-apisports-key': API_KEY },
            params: { next: 50 },
            timeout: 20000
        });

        let jogos = filterFutureGames(res.data.response || []);

        if (!jogos.length) {
            const hoje = new Date();
            const daqui7 = new Date();
            daqui7.setDate(hoje.getDate() + 7);

            const from = hoje.toISOString().split('T')[0];
            const to = daqui7.toISOString().split('T')[0];

            res = await axios.get('https://v3.football.api-sports.io/fixtures', {
                headers: { 'x-apisports-key': API_KEY },
                params: { from, to },
                timeout: 20000
            });

            jogos = filterFutureGames(res.data.response || []);
        }

        cacheJogos = jogos;
        ultimoCacheJogos = agora;
        return jogos;
    } catch (err) {
        console.log('[ERRO JOGOS]', err.response?.data || err.message);
        return cacheJogos;
    }
}

async function getLive() {
    const agora = Date.now();

    if (agora - ultimoCacheLive < 30000 && cacheLive.length > 0) {
        return cacheLive;
    }

    try {
        const res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            headers: { 'x-apisports-key': API_KEY },
            params: { live: 'all' },
            timeout: 20000
        });

        cacheLive = res.data.response || [];
        ultimoCacheLive = agora;
        return cacheLive;
    } catch (err) {
        console.log('[ERRO LIVE]', err.response?.data || err.message);
        return cacheLive;
    }
}

client.on('qr', qr => {
    currentQr = qr;
    botStatus = 'aguardando_qr';
    qrcode.generate(qr, { small: true });
    console.log('====== QR CODE GERADO ======');
    console.log('Abra no navegador: /qr');
    console.log('============================');
});

client.on('ready', () => {
    currentQr = null;
    botStatus = 'conectado';
    console.log('[BOT] ✅ Bot conectado!');
});

client.on('authenticated', () => {
    botStatus = 'autenticado';
    console.log('[BOT] Sessão autenticada.');
});

client.on('auth_failure', msg => {
    botStatus = 'falha_autenticacao';
    console.log('[BOT] Falha na autenticação:', msg);
});

client.on('disconnected', reason => {
    botStatus = 'desconectado';
    console.log('[BOT] Conexão fechada. Motivo:', reason);
});

client.on('message', async msg => {
    try {
        console.log(`[MSG] ${msg.body || ''}`);

        if (!isGroupMessage(msg)) return;

        const user = msg.author || msg.from;
        const text = (msg.body || '').toLowerCase().trim();

        if (!usuarios.has(user)) {
            usuarios.add(user);

            await msg.reply(
`🚨 *LEIA PARA NÃO SER REMOVIDO!* 🚨

🏆 *Champions Bet Club*

O Champions Bet Club é um projeto financiado por nosso patrocinador oficial. Para manter o acesso GRATUITO às nossas análises premium, sorteios e cashback, você precisa:

1️⃣ Criar sua conta aqui:
https://81gg6.com/?pid=4840583013

2️⃣ Realizar um depósito mínimo para validar sua conta.
3️⃣ Enviar seu ID no privado para liberar seu bônus de boas-vindas.

🎁 *VANTAGENS DE SER UM AFILIADO:*
💰 Cashback em rodadas selecionadas.
🎟 Sorteios semanais exclusivos via ID.
📈 As melhores tips do mercado sem pagar mensalidade!

📌 *COMANDOS:*
!menu
!jogos
!tips
!placar
!banca`
            );
        }

        if (cooldown.has(user)) return;

        if (text === '!menu') {
            startCooldown(user);
            await msg.reply(
`📋 *MENU*

!jogos 📅
!tips 🔥
!placar 📊
!banca 💰`
            );
            return;
        }

        if (text === '!jogos') {
            startCooldown(user);
            const jogos = await getJogos();

            if (!jogos.length) {
                await msg.reply('⚠️ Não encontrei jogos futuros agora. Tente novamente em alguns minutos.');
                return;
            }

            let resposta = `📅 *PRÓXIMOS JOGOS*\n\n`;

            jogos.slice(0, 12).forEach(j => {
                resposta += `⚽ ${j.teams.home.name} x ${j.teams.away.name}\n`;
                resposta += `🕒 ${formatDateBR(j.fixture.date)}\n\n`;
            });

            await msg.reply(resposta);
            return;
        }

        if (text === '!tips') {
            startCooldown(user);
            const jogos = await getJogos();

            if (!jogos.length) {
                await msg.reply('⚠️ Não consegui montar uma tip agora. Tente novamente em alguns minutos.');
                return;
            }

            const jogo = jogos[Math.floor(Math.random() * jogos.length)];

            await msg.reply(
`🔥 *TIP DO DIA*

⚽ ${jogo.teams.home.name} x ${jogo.teams.away.name}
🕒 ${formatDateBR(jogo.fixture.date)}

📊 Sugestão:
Mais de 1.5 gols

⚠️ Gestão sempre!`
            );
            return;
        }

        if (text === '!placar') {
            startCooldown(user);
            const jogos = await getLive();

            if (!jogos.length) {
                await msg.reply('⚠️ Nenhum jogo ao vivo no momento.');
                return;
            }

            let resposta = `🔴 *AO VIVO*\n\n`;

            jogos.slice(0, 15).forEach(j => {
                resposta += `⚽ ${j.teams.home.name} ${j.goals.home ?? 0} x ${j.goals.away ?? 0} ${j.teams.away.name}\n`;
                resposta += `⏱ ${j.fixture.status?.elapsed ?? '-'}'\n\n`;
            });

            await msg.reply(resposta);
            return;
        }

        if (text === '!banca') {
            startCooldown(user);
            await msg.reply(
`💰 *GESTÃO DE BANCA*

✔️ Use 2% a 5% por aposta
✔️ Nunca vá all-in
✔️ Controle emocional
✔️ Foque no longo prazo`
            );
        }
    } catch (err) {
        console.log('[ERRO MESSAGE]', err.message);
    }
});

app.get('/', (req, res) => {
    res.send(`
        <html>
            <body style="font-family:Arial;padding:24px">
                <h2>Bot WhatsApp Mike</h2>
                <p>Status: <b>${botStatus}</b></p>
                <p>QR: <a href="/qr">abrir QR</a></p>
            </body>
        </html>
    `);
});

app.get('/qr', (req, res) => {
    if (!currentQr) {
        return res.send(`
            <html>
                <body style="font-family:Arial;padding:24px">
                    <h3>QR ainda não está disponível.</h3>
                    <p>Atualize esta página em alguns segundos.</p>
                </body>
            </html>
        `);
    }

    res.send(`
        <html>
            <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111;color:#fff;font-family:Arial">
                <div style="text-align:center">
                    <h2>Escaneie o QR Code</h2>
                    <img alt="qr" src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(currentQr)}" />
                </div>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`[WEB] Servidor ouvindo na porta ${PORT}`);
});

client.initialize();