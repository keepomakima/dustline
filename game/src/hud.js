// The DOM HUD: health, money, timer, round score, alive count, kill feed, bomb status,
// plant bar, buy menu, minimap (canvas, spotted bots only), damage vignette, banners
// and the Tab scoreboard. It never touches the simulation; main.js pushes numbers in.
import { WEAPONS, GRENADE } from './weapons.js';

const COPY = {
  start: { title: 'DUSTLINE — Yard 7', copy: 'Five WARDENs hold the yard. Plant the bomb at Site A or B, or eliminate them all. First to 4 rounds.', action: 'Click to play' },
  paused: { title: 'DUSTLINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  end: { title: 'Match over', copy: '', action: 'Play again' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'), play: $('play'),
    ammo: $('ammo'), mag: $('ammo-mag'), reserve: $('ammo-reserve'),
    health: $('health-value'), healthBar: $('health-bar'), money: $('money'),
    timer: $('timer-value'), round: $('round-value'), alive: $('alive-value'),
    feed: $('killfeed'), banner: $('banner'), bomb: $('bomb-status'),
    plant: $('plant-bar'), plantFill: $('plant-fill'), plantLabel: $('plant-label'),
    buy: $('buy-menu'), buyList: $('buy-list'), buyMoney: $('buy-money'), deploy: $('deploy'),
    scoreboard: $('scoreboard'), scoreRows: $('score-rows'),
    minimap: $('minimap'), vignette: $('vignette'), weaponName: $('weapon-name'),
    grenades: $('grenade-count'),
  };
  const mapCtx = els.minimap.getContext('2d');
  let last = {};
  function setText(el, key, value) { if (last[key] !== value) { last[key] = value; el.textContent = value; } }

  return {
    setAmmo(mag, reserve, name, grenades) {
      setText(els.mag, 'mag', String(mag));
      setText(els.reserve, 'res', `/ ${reserve}`);
      setText(els.weaponName, 'wname', name);
      setText(els.grenades, 'nades', grenades > 0 ? `◉ ${grenades}` : '');
      els.ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      setText(els.health, 'hp', String(Math.max(0, Math.round(hp))));
      els.healthBar.style.width = `${Math.max(0, hp)}%`;
      els.healthBar.style.background = hp > 50 ? 'var(--ink)' : hp > 25 ? 'var(--accent)' : '#c8452c';
    },
    setMoney(m) { setText(els.money, 'money', `$${m}`); },
    setTimer(s) {
      const t = Math.max(0, Math.ceil(s));
      setText(els.timer, 'timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      els.timer.parentElement.classList.toggle('urgent', t <= 15);
    },
    setRound(us, them, round) { setText(els.round, 'round', `R${round} · ${us}–${them}`); },
    setAlive(n) { setText(els.alive, 'alive', `WARDENS LEFT ${n}`); },
    setBomb(text) { setText(els.bomb, 'bomb', text); },
    feed(text) {
      const div = document.createElement('div');
      div.textContent = text;
      els.feed.prepend(div);
      while (els.feed.children.length > 5) els.feed.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    hitMarker(killed, holdMs = 90) {
      const hm = document.getElementById('hitmarker');
      hm.classList.add('on');
      hm.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hm._t);
      hm._t = setTimeout(() => { hm.classList.remove('on'); hm.style.transform = ''; }, holdMs);
    },
    damageFlash() {
      els.vignette.classList.add('on');
      setTimeout(() => els.vignette.classList.remove('on'), 180);
    },
    banner(text, ms = 2600) {
      els.banner.textContent = text;
      els.banner.classList.add('on');
      clearTimeout(els.banner._t);
      els.banner._t = setTimeout(() => els.banner.classList.remove('on'), ms);
    },
    plantBar(progress, label) {
      if (progress <= 0) { els.plant.hidden = true; return; }
      els.plant.hidden = false;
      els.plantFill.style.width = `${Math.min(100, progress * 100)}%`;
      setText(els.plantLabel, 'plant', label);
    },
    showOverlay(mode, extra = '') {
      const text = COPY[mode];
      els.title.textContent = text.title;
      els.copy.textContent = mode === 'end' ? extra : text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() { els.overlay.hidden = true; },
    onPlay(handler) { els.play.addEventListener('click', handler); },
    showBuy(money, owned, grenades, onBuy) {
      els.buy.hidden = false;
      setText(els.buyMoney, 'buymoney', `$${money}`);
      els.buyList.innerHTML = '';
      const rows = [...Object.entries(WEAPONS), ['grenade', { name: GRENADE.name, price: GRENADE.price, damage: GRENADE.damage, mag: '—', reserve: '', gap: '', reload: '', spreadStill: '', head: '' }]];
      for (const [kind, w] of rows) {
        const ownedNow = kind === 'grenade' ? grenades >= 2 : owned.includes(kind);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'buy-card';
        btn.disabled = ownedNow;
        const stats = kind === 'grenade'
          ? `Blast ${w.damage} · radius 6 m · fuse 1.6 s`
          : `DMG ${w.damage} · head ×${w.head} · mag ${w.mag} · ${w.auto ? 'auto' : 'semi'} · ${w.range} m`;
        btn.innerHTML = `<b>${w.name}</b><span>${stats}</span><em>${ownedNow ? 'OWNED' : '$' + w.price}</em>`;
        btn.addEventListener('click', () => onBuy(kind));
        els.buyList.appendChild(btn);
      }
    },
    hideBuy() { els.buy.hidden = true; },
    onDeploy(handler) { els.deploy.addEventListener('click', handler); },
    showScoreboard(rows) {
      els.scoreboard.hidden = false;
      els.scoreRows.innerHTML = rows.map((r) =>
        `<tr><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.hp}</td><td>${r.money}</td></tr>`).join('');
    },
    hideScoreboard() { els.scoreboard.hidden = true; },
    drawMinimap(playerPos, yaw, bots, sites, bombPos) {
      const c = mapCtx; const S = 132;
      c.clearRect(0, 0, S, S);
      c.fillStyle = 'rgba(20,22,26,0.85)'; c.fillRect(0, 0, S, S);
      const toMap = (x, z) => [((x + 22) / 44) * S, ((z + 17) / 34) * S];
      c.strokeStyle = '#4a4238'; c.lineWidth = 2; c.strokeRect(1, 1, S - 2, S - 2);
      for (const [key, s] of Object.entries(sites)) {
        const [mx, my] = toMap(s.x, s.z);
        c.fillStyle = '#f0a830'; c.font = 'bold 13px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(key, mx, my);
      }
      if (bombPos) {
        const [mx, my] = toMap(bombPos.x, bombPos.z);
        c.fillStyle = '#c8452c'; c.beginPath(); c.arc(mx, my, 5, 0, Math.PI * 2); c.fill();
      }
      for (const b of bots) {
        if (!b.alive || !b.spotted) continue;
        const [mx, my] = toMap(b.body.position.x, b.body.position.z);
        c.fillStyle = '#c8452c'; c.beginPath(); c.arc(mx, my, 3.5, 0, Math.PI * 2); c.fill();
      }
      const [px, py] = toMap(playerPos.x, playerPos.z);
      c.fillStyle = '#efe8d8';
      c.save(); c.translate(px, py); c.rotate(Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) + Math.PI / 2);
      c.beginPath(); c.moveTo(0, -6); c.lineTo(4.5, 5); c.lineTo(-4.5, 5); c.closePath(); c.fill(); c.restore();
    },
  };
}
