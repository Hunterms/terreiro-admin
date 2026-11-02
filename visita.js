// Conta visita no site do terreiro. Manda o tipo da página pro Worker, que tira
// robô, guarda só a cidade e um código do dia (sem IP) e grava em site_visitas.
//
// Quem é da casa abre uma vez terreirodocandieiro.com.br/?equipe=1 em cada
// aparelho: o aparelho sai da conta pra sempre (link no card do admin).
//
// As páginas chamam window.visita('horario', { servico }) e window.visita('enviou')
// no agendar, pro funil. O resto é automático no carregar.
(() => {
  const URL_VISITA = window.VISITA_URL || 'https://terreiro-email.hunter-soares-c.workers.dev/visita';
  const q = new URLSearchParams(location.search);
  try {
    if (q.get('equipe') === '1') localStorage.setItem('candieiro_equipe', '1');
    if (q.get('equipe') === '0') localStorage.removeItem('candieiro_equipe');
    if (localStorage.getItem('candieiro_equipe')) { window.visita = () => {}; return; }
  } catch {}
  const nome = location.pathname.split('/').pop().replace('.html', '') || 'index';
  const PAGINAS = { index: 'home', agendar: 'agendar', buzios: 'buzios', 'baralho-cigano': 'baralho', visitar: 'visitar', evento: 'evento', vendas: 'vendas' };
  const ref = document.referrer && !document.referrer.includes(location.host) ? new URL(document.referrer).host : '';
  window.visita = (tipo, extra = {}) => {
    // text/plain não dispara preflight de CORS; o Worker lê o corpo como JSON igual.
    const corpo = JSON.stringify({ tipo, ref, utm: q.get('utm_source') || '', ...extra });
    if (!navigator.sendBeacon?.(URL_VISITA, corpo)) fetch(URL_VISITA, { method: 'POST', body: corpo, keepalive: true }).catch(() => {});
  };
  window.visita(PAGINAS[nome] || 'outra', { servico: q.get('s') || '' });
})();
