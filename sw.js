/**
 * Service worker do Candieiro — o que faz o site virar app no celular.
 *
 * Dois trabalhos, e só esses dois:
 *   1. existir, pra o Android oferecer "instalar" e o iOS aceitar notificação
 *   2. desenhar a notificação que chega e levar pro lugar certo no clique
 *
 * O que ele NÃO faz: cache offline. Um admin que mostra escala, saldo e pedido
 * de ontem é pior que um admin que diz "sem internet" — dado errado com cara de
 * certo. Se um dia precisar funcionar sem rede, o lugar é aqui, e aí é escolher
 * o que pode ficar velho.
 *
 * ATUALIZAR: mude VERSAO. O navegador só troca o service worker quando o
 * arquivo muda em byte, e sem uma marca visível fica difícil saber qual está no
 * ar. `skipWaiting` + `clients.claim` fazem a troca valer já, sem esperar todas
 * as abas fecharem.
 */

const VERSAO = 'candieiro-2026-08-01';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Handler de fetch vazio: passa direto pra rede, sem interceptar nada. Está
// aqui porque parte dos navegadores só considera o site instalável se o service
// worker escutar fetch. É a versão honesta do requisito — não finge cache.
self.addEventListener('fetch', () => {});

// ── NOTIFICAÇÃO ────────────────────────────────────────────────────────────
// O Worker manda só `data` (sem `notification`), então quem desenha é aqui.
// Fosse pelos dois, o navegador mostraria uma e este handler outra: duas
// notificações pro mesmo fato.
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = {}; }
  const d = p.data || p.notification || p;

  const titulo = d.titulo || d.title || 'Terreiro do Candieiro';
  const url = d.url || 'index.html';

  // O iOS pode revogar a permissão de quem recebe push e não mostra nada.
  // Então todo push vira notificação, mesmo o malformado.
  event.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || d.body || '',
    icon: './logocandieiro.png',
    badge: './logocandieiro.png',
    // Mesma `tag` substitui a anterior em vez de empilhar: três pedidos de
    // consulta viram uma linha, não três. `renotify` faz vibrar mesmo assim.
    tag: d.tag || 'geral',
    renotify: true,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Resolve contra o escopo, não contra a raiz do domínio: em GitHub Pages o
  // site mora em /terreiro-admin/, e '/index.html' cairia fora dele.
  const alvo = new URL(event.notification.data?.url || 'index.html', self.registration.scope).href;
  const base = alvo.split('#')[0];

  event.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const aba of abas) {
      if (aba.url.split('#')[0] === base) {
        await aba.focus();
        if (aba.navigate) await aba.navigate(alvo).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(alvo);
  })());
});

console.log('sw', VERSAO);
