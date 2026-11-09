/* Food Rescue - Rewards & Leaderboard (frontend DEMO).
   All data below is generated sample data. Points, rankings and redemptions here are NOT secure and NOT connected
   to live verified donations. Duplicate prevention, verification, redemption and access control must run on a backend. */
(() => {
  "use strict";
  /* ---- Admin-configurable values (move to a backend admin panel in production) ---- */
  const CFG = {
    pointsPerDonation: 50,
    bonuses: { 5: 100, 10: 200, 25: 500 },                 // milestone: donations -> bonus points
    weights: { donations: 0.5, meals: 0.3, consistency: 0.2 }, // transparent ranking formula
    tiers: [
      { id: "bronze", name: "Bronze", icon: "🥉", min: 0, title: "Beginner Food Hero" },
      { id: "silver", name: "Silver", icon: "🥈", min: 500, title: "Active Food Contributor" },
      { id: "gold", name: "Gold", icon: "🥇", min: 1500, title: "Food Rescue Champion" },
      { id: "platinum", name: "Platinum", icon: "💎", min: 3000, title: "Sustainability Leader" }
    ],
    rewards: [
      { id: "cert", icon: "📜", name: "Digital achievement certificate", cost: 100, tier: 0 },
      { id: "badge", icon: "🏅", name: "Exclusive restaurant profile badge", cost: 150, tier: 0 },
      { id: "social", icon: "📣", name: "Social media appreciation certificate", cost: 200, tier: 0 },
      { id: "sustain", icon: "🌱", name: "Sustainability achievement recognition", cost: 250, tier: 1 },
      { id: "featured", icon: "⭐", name: "Featured restaurant placement", cost: 400, tier: 1 },
      { id: "champ", icon: "🏆", name: "Food Rescue Champion recognition", cost: 600, tier: 2 },
      { id: "visible", icon: "🔭", name: "Increased visibility (featured listings)", cost: 800, tier: 2 }
    ]
  };
  const KEY = "foodRescue.rewards.v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const mk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const fmt = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const NOW = new Date();

  /* ---- Months (oldest to current). Past months are complete, so their rankings never change. ---- */
  const MONTHS = [3, 2, 1, 0].map((o) => {
    const s = new Date(NOW.getFullYear(), NOW.getMonth() - o, 1);
    return { key: mk(s), start: s, done: o > 0, label: s.toLocaleString("en-IN", { month: "long", year: "numeric" }),
      days: o ? new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate() : NOW.getDate(),
      weeks: o ? 4 : Math.min(4, Math.floor((NOW.getDate() - 1) / 7) + 1) };
  });

  /* ---- Data layer: donation records {id, rid, at, meals, status}. Only "verified" ever counts. ---- */
  const DEMO = [
    ["gl", "Green Leaf Restaurant", [14, 15, 16, 9]], ["sr", "Spice Route Canteen", [11, 12, 13, 8]],
    ["gc", "Golden Crust Bakery", [8, 10, 9, 7]], ["sp", "Hotel Saffron Palace", [6, 7, 9, 6]],
    ["cb", "Cafe Brew", [5, 4, 7, 5]], ["sm", "Sunrise Mess Hall", [3, 5, 4, 3]],
    ["fm", "Fresh Mart Kitchen", [2, 3, 2, 4]], ["cd", "The Corner Dhaba", [1, 2, 3, 2]]
  ];
  const NOT_COUNTED = ["posted", "cancelled", "expired", "rejected"];
  function rnd(seed) { let x = seed * 9301 + 49297; return () => (x = (x * 9301 + 49297) % 233280) / 233280; }

  function demoRecords() {
    const out = [];
    DEMO.forEach(([rid, , counts], ri) => {
      const r = rnd(ri + 3);
      counts.forEach((n, mi) => {
        const m = MONTHS[mi];
        for (let i = 0; i < n; i++) {
          out.push({ id: `${rid}-${m.key}-${i}`, rid, at: new Date(m.start.getFullYear(), m.start.getMonth(), 1 + Math.floor(i * m.days / n), 12), meals: 15 + Math.floor(r() * 60), status: "verified" });
        }
        // records that must never earn anything
        out.push({ id: `${rid}-${m.key}-x`, rid, at: new Date(m.start.getFullYear(), m.start.getMonth(), 2, 12), meals: 30, status: NOT_COUNTED[(ri + mi) % 4] });
      });
    });
    return out;
  }
  /** Donations picked up in this browser's own food board (prototype has no receiver confirmation step). */
  function localRecords() {
    try {
      const list = JSON.parse(localStorage.getItem("foodRescue.listings.v2") || "[]");
      const acc = JSON.parse(localStorage.getItem("foodRescue.account.v1") || "{}");
      return list.filter((l) => l && !l.sample && l.status === "Picked Up" && acc.id && l.donorId === acc.id)
        .map((l) => ({ id: "you-" + l.id, rid: "you", at: new Date(l.createdAt || Date.now()), meals: Number(l.servings) || 0, status: "verified", name: acc.name }));
    } catch (e) { return []; }
  }
  let RECORDS = [], V = [], PEOPLE = [];
  function loadData() {
    RECORDS = [...demoRecords(), ...localRecords()];
    const seen = new Map();                                   // duplicate prevention: one record id counts once
    RECORDS.forEach((x) => { if (x.status === "verified" && !seen.has(x.id)) seen.set(x.id, x); });
    V = [...seen.values()].filter((x) => MONTHS.some((m) => m.key === mk(x.at)));
    PEOPLE = DEMO.map(([rid, name]) => ({ rid, name }));
    const mine = V.find((x) => x.rid === "you");
    if (mine) PEOPLE.unshift({ rid: "you", name: (mine.name ? mine.name + " " : "Your donations ") + "(this browser)" });
  }

  /* ---- Reusable logic ---- */
  const tierIndex = (pts) => CFG.tiers.reduce((a, t, i) => (pts >= t.min ? i : a), 0);
  function ledger(rid) {
    const ev = [];
    V.filter((x) => x.rid === rid).sort((a, b) => a.at - b.at).forEach((x, i) => {
      ev.push({ at: x.at, label: `Donation completed (${x.meals} meals)`, pts: CFG.pointsPerDonation });
      if (CFG.bonuses[i + 1]) ev.push({ at: x.at, label: `Milestone bonus: ${i + 1} donations`, pts: CFG.bonuses[i + 1] });
    });
    return ev;
  }
  function redeemed() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function account(rid) {
    const earned = ledger(rid).reduce((a, e) => a + e.pts, 0);
    const spent = (redeemed()[rid] || []).reduce((a, r) => a + r.cost, 0);
    return { earned, spent, balance: earned - spent, tier: tierIndex(earned) };   // tier uses lifetime points, so redeeming never lowers it
  }
  function monthStats(rid, key) {
    const m = MONTHS.find((x) => x.key === key), rs = V.filter((x) => x.rid === rid && mk(x.at) === key);
    const wk = new Set(rs.map((x) => Math.min(3, Math.floor((x.at.getDate() - 1) / 7))));
    return { d: rs.length, m: rs.reduce((a, x) => a + x.meals, 0), c: Math.round(100 * Math.min(wk.size, m.weeks) / m.weeks) };
  }
  /** Ranking formula: 50% verified donations, 30% meals rescued, 20% consistency (each relative to the period's best). */
  function stats(period) {
    const keys = period === "all" ? MONTHS.map((m) => m.key) : [period];
    const rows = PEOPLE.map((p) => {
      const s = keys.map((k) => monthStats(p.rid, k));
      return { ...p, donations: s.reduce((a, x) => a + x.d, 0), meals: s.reduce((a, x) => a + x.m, 0), consistency: Math.round(s.reduce((a, x) => a + x.c, 0) / s.length) };
    }).filter((r) => r.donations > 0);
    const maxD = Math.max(1, ...rows.map((r) => r.donations)), maxM = Math.max(1, ...rows.map((r) => r.meals)), W = CFG.weights;
    rows.forEach((r) => { r.score = Math.round(1000 * (W.donations * r.donations / maxD + W.meals * r.meals / maxM + W.consistency * r.consistency / 100)) / 10; });
    return rows;
  }
  const SORTS = { score: (a, b) => b.score - a.score, donations: (a, b) => b.donations - a.donations || b.score - a.score,
    meals: (a, b) => b.meals - a.meals || b.score - a.score, consistency: (a, b) => b.consistency - a.consistency || b.score - a.score };
  const ranked = (period, by = "score") => stats(period).sort(SORTS[by]);
  function awards(period) {
    const rows = stats(period); if (!rows.length) return null;
    const best = (by) => [...rows].sort(SORTS[by])[0];
    return { donor: best("donations"), meals: best("meals"), steady: best("consistency") };
  }
  const done = MONTHS.filter((m) => m.done);
  const topRanks = (rid) => done.map((m) => ranked(m.key).findIndex((r) => r.rid === rid) + 1);
  const isHero = (rid) => topRanks(rid).every((r) => r >= 1 && r <= 3);   // top 3 in three consecutive completed months
  const isSteady = (rid) => done.every((m) => monthStats(rid, m.key).c >= 75);

  /* ---- UI helpers ---- */
  function toast(msg, type = "success") {
    const box = $("#toastContainer"); if (!box) return;
    const t = document.createElement("div");
    t.className = ("toast " + (type === "success" ? "" : type)).trim(); t.setAttribute("role", type === "error" ? "alert" : "status");
    t.innerHTML = '<span class="toast-msg"></span><button type="button" aria-label="Dismiss notification">×</button>';
    t.querySelector(".toast-msg").textContent = msg;
    const off = () => { t.classList.add("hide"); setTimeout(() => t.remove(), 300); };
    t.querySelector("button").onclick = off; box.appendChild(t); setTimeout(off, 5000);
  }
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function count(el, to) {
    if (reduced()) { el.textContent = to.toLocaleString("en-IN"); return; }
    const t0 = performance.now();
    requestAnimationFrame(function step(t) { const p = Math.min(1, (t - t0) / 1000), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e).toLocaleString("en-IN"); if (p < 1) requestAnimationFrame(step); });
  }
  const countUp = (root) => $$("[data-count]", root).forEach((el) => count(el, +el.dataset.count));
  function confetti() {
    if (reduced()) return;
    const colors = ["🎉", "🌿", "⭐", "🍃", "✨"];
    for (let i = 0; i < 36; i++) {
      const s = document.createElement("span"); s.className = "confetti"; s.textContent = colors[i % colors.length];
      s.style.left = Math.random() * 100 + "vw"; s.style.fontSize = 14 + Math.random() * 18 + "px"; s.style.animationDuration = 2 + Math.random() * 2 + "s";
      document.body.appendChild(s); setTimeout(() => s.remove(), 4500);
    }
  }
  const monthBars = (rid) => { const bars = MONTHS.map((m) => ({ l: m.label.split(" ")[0].slice(0, 3), d: monthStats(rid, m.key).d })), mx = Math.max(1, ...bars.map((b) => b.d));
    return `<div class="rw-months">${bars.map((b) => `<div><b>${b.d}</b><i style="height:${Math.round(100 * b.d / mx * 0.8)}%"></i>${b.l}</div>`).join("")}</div>`; };

  /* ---- Hero: community totals from the same verified records ---- */
  function renderHero() {
    const pts = PEOPLE.reduce((a, p) => a + account(p.rid).earned, 0);
    const items = [[V.reduce((a, x) => a + x.meals, 0), "Meals rescued", "🍱"], [V.length, "Verified donations", "✅"], [PEOPLE.filter((p) => V.some((x) => x.rid === p.rid)).length, "Restaurants", "🏪"], [pts, "Points awarded", "⭐"]];
    $("#heroStats").innerHTML = items.map(([n, l, i]) => `<div class="rw-hs"><b><span data-count="${n}">0</span></b><span>${i} ${l}</span></div>`).join("");
    countUp($("#heroStats"));
  }

  /* ---- Rewards tab ---- */
  function renderRewards() {
    const rid = $("#rwRestaurant").value, a = account(rid), T = CFG.tiers, cur = T[a.tier], nxt = T[a.tier + 1], mine = V.filter((x) => x.rid === rid);
    const pct = nxt ? Math.min(100, Math.round(100 * (a.earned - cur.min) / (nxt.min - cur.min))) : 100;
    const frac = nxt ? (a.earned - cur.min) / (nxt.min - cur.min) : 0, ladderPct = Math.min(100, Math.round(((a.tier + frac) / (T.length - 1)) * 100));
    const got = (redeemed()[rid] || []).map((r) => r.id), C = 2 * Math.PI * 54;
    let bal = 0;
    const evs = [...ledger(rid), ...(redeemed()[rid] || []).map((r) => ({ at: new Date(r.at), label: "Redeemed: " + r.name, pts: -r.cost }))].sort((x, y) => x.at - y.at)
      .map((e) => ({ ...e, bal: (bal += e.pts) })).reverse().slice(0, 8);
    $("#rwBody").innerHTML = `
      <div class="rw-wallet">
        <div class="rw-wallet-main"><div class="ring-wrap"><svg class="ring" viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="54"/><circle class="ring-fg" id="ringFg" cx="60" cy="60" r="54" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-to="${C * (1 - pct / 100)}"/></svg>
          <div class="ring-text"><small>Balance</small><b data-count="${a.balance}">0</b><span>points</span></div></div>
          <div class="tier-now">${cur.icon} ${cur.name} · ${esc(cur.title)}</div>
          <p>${nxt ? `${nxt.min - a.earned} points to ${nxt.icon} ${nxt.name}` : "Top tier reached 💎"}</p></div>
        <div class="rw-stats">
          <div class="rw-stat"><div class="ic">✅</div><div><b data-count="${mine.length}">0</b><span>Successful verified donations</span></div></div>
          <div class="rw-stat"><div class="ic">🍱</div><div><b data-count="${mine.reduce((s, x) => s + x.meals, 0)}">0</b><span>Total meals rescued</span></div></div>
          <div class="rw-stat"><div class="ic">⭐</div><div><b data-count="${a.earned}">0</b><span>Lifetime points earned</span></div></div>
          <div class="rw-stat"><div class="ic">🎁</div><div><b data-count="${CFG.rewards.filter((r) => !got.includes(r.id) && a.tier >= r.tier && a.balance >= r.cost).length}">0</b><span>Rewards you can redeem now</span></div></div>
        </div></div>
      <h3 class="rw-h3">Reward tiers</h3>
      <div class="ladder"><div class="ladder-line"><i id="ladderFill" data-to="${ladderPct}"></i></div>
        ${T.map((t, i) => `<div class="rung ${i <= a.tier ? "reached" : ""} ${i === a.tier ? "now" : ""}"><div class="medal">${t.icon}</div><b>${t.name}</b><small>${t.min}${T[i + 1] ? "–" + (T[i + 1].min - 1) : "+"} pts</small><small>${esc(t.title)}</small></div>`).join("")}</div>
      <h3 class="rw-h3">Redeem rewards</h3>
      <div class="rw-rewards">${CFG.rewards.map((r) => {
        const has = got.includes(r.id), why = has ? "Redeemed ✓" : a.tier < r.tier ? `🔒 Unlocks at ${T[r.tier].name}` : a.balance < r.cost ? `Need ${r.cost - a.balance} more points` : "Ready to redeem";
        const ok = why === "Ready to redeem";
        return `<div class="ticket ${ok || has ? "" : "locked"} ${has ? "got" : ""}"><div class="top">${r.icon}</div><div class="body"><strong>${esc(r.name)}</strong><span class="cost">${r.cost} pts</span>
          <span class="why">${why}</span><button class="btn ${ok ? "btn-accent" : "btn-outline"} btn-sm" data-redeem="${r.id}" ${ok ? "" : "disabled"}>${has ? "Redeemed" : "Redeem Reward"}</button></div></div>`;
      }).join("")}</div>
      <div class="rw-two" style="margin-top:2.6rem">
        <div class="rw-box"><h3>Monthly donation activity</h3>${monthBars(rid)}</div>
        <div class="rw-box"><h3>Recent rewards activity</h3>${evs.length ? `<div class="timeline">${evs.map((e) => `<div class="tl ${e.pts < 0 ? "neg" : ""}"><span>${esc(e.label)}<small>${fmt(e.at)} · balance ${e.bal}</small></span><span class="${e.pts > 0 ? "pos" : "neg-t"}">${e.pts > 0 ? "+" : ""}${e.pts}</span></div>`).join("")}</div>`
          : '<div class="rw-state">No verified donations yet. Points appear after a pickup is confirmed.</div>'}</div></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => { $("#ringFg").style.strokeDashoffset = $("#ringFg").dataset.to; $("#ladderFill").style.width = $("#ladderFill").dataset.to + "%"; }));
    countUp($("#rwBody"));
  }
  function redeem(id) {
    const rid = $("#rwRestaurant").value, r = CFG.rewards.find((x) => x.id === id), a = account(rid), all = redeemed(), mine = all[rid] || [];
    if (!r) return;
    if (mine.some((x) => x.id === id)) return toast("This reward was already redeemed.", "error");
    if (a.tier < r.tier) return toast(`${CFG.tiers[r.tier].name} tier is required for this reward.`, "error");
    if (a.balance < r.cost) return toast(`You need ${r.cost - a.balance} more points.`, "error");
    if (!confirm(`Redeem "${r.name}" for ${r.cost} points?`)) return;
    mine.push({ id, name: r.name, cost: r.cost, at: Date.now() }); all[rid] = mine;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { return toast("Could not save the redemption in this browser.", "error"); }
    renderRewards(); confetti(); toast(`Redeemed "${r.name}". ${r.cost} points deducted (demo only, saved in this browser).`);
  }

  /* ---- Leaderboard tab ---- */
  const view = { period: "all", sort: "score" };
  const badgeFor = (rank, r) => rank === 1 ? "🥇 Gold Champion" : rank === 2 ? "🥈 Silver Champion" : rank === 3 ? "🥉 Bronze Champion" : r.consistency >= 75 ? "🌱 Consistent" : "Contributor";
  function renderBoard() {
    const periods = [[MONTHS[3].key, "Current month"], [MONTHS[2].key, "Previous month"], ["all", "All available months"]];
    const sorts = [["score", "Overall score"], ["donations", "Most donations"], ["meals", "Most meals"], ["consistency", "Highest consistency"]];
    const rows = ranked(view.period, view.sort), w = awards(view.period), maxS = Math.max(1, ...rows.map((r) => r.score));
    const chips = (list, cur, attr) => list.map(([v, l]) => `<button class="chip" ${attr}="${v}" aria-pressed="${v === cur}">${l}</button>`).join("");
    const champs = done.map((m) => ({ m, r: ranked(m.key)[0] })).filter((x) => x.r);
    const heroes = PEOPLE.filter((p) => isHero(p.rid)), steady = PEOPLE.filter((p) => isSteady(p.rid) && V.some((x) => x.rid === p.rid));
    const card = (icon, title, r, line) => `<div class="award"><div class="big">${icon}</div><h4>${title}</h4><strong>${esc(r.name)}</strong><p>${line}</p><button class="btn btn-sm" data-share="${r.rid}">Share Achievement</button></div>`;
    $("#lbBody").innerHTML = `
      <div class="chips"><span class="lbl">Period</span>${chips(periods, view.period, "data-period")}</div>
      <div class="chips"><span class="lbl">Sort by</span>${chips(sorts, view.sort, "data-sort")}</div>
      ${rows.length ? `<div class="podium">${rows.slice(0, 3).map((r, i) => `<div class="pod p${i + 1}">${i === 0 ? '<span class="crown">👑</span>' : ""}<span class="medal">${["🥇", "🥈", "🥉"][i]}</span>
        <h4>${esc(r.name)}</h4><p>${r.meals} meals · ${r.donations} donations</p><p>${["Gold", "Silver", "Bronze"][i]} Champion</p><span class="score">${r.score}</span><button class="btn btn-sm" data-profile="${r.rid}">View Profile</button></div>`).join("")}</div>
      <div class="rank-list">${rows.map((r, i) => `<div class="rank ${i < 3 ? "top" : ""}" style="animation-delay:${i * 50}ms"><div class="n">${i + 1}</div><div><strong>${esc(r.name)}</strong><small>${badgeFor(i + 1, r)}</small></div>
        <div class="bar-box"><div class="bar"><i style="width:${Math.round(100 * r.score / maxS)}%"></i></div><div class="bar-meta"><span>${r.meals} meals</span><span>${r.donations} verified donations</span><span>${r.consistency}% consistency</span></div></div>
        <button class="btn btn-outline btn-sm" data-profile="${r.rid}">View Profile</button></div>`).join("")}</div>`
        : '<div class="rw-state">No verified donations for this period yet.</div>'}
      <p class="rw-foot" style="margin:1rem 0 0;text-align:left">Score = 50% verified donations + 30% meals rescued + 20% consistency (share of weeks with a verified donation). Past months are complete and never change.</p>
      <h3 class="rw-h3">Public recognition awards</h3>
      ${w ? `<div class="awards">${card("🏆", "Top Food Donor", w.donor, w.donor.donations + " verified donations")}${card("🍱", "Most Meals Rescued", w.meals, w.meals.meals + " meals rescued")}${card("🌱", "Consistency Champion", w.steady, w.steady.consistency + "% consistency")}</div>` : '<div class="rw-state">Awards appear once a period has verified donations.</div>'}
      <h3 class="rw-h3">Restaurant Hall of Fame</h3>
      <div class="rw-two"><div class="rw-box"><h3>🦸 Food Rescue Hero</h3><p style="color:var(--gray-500);font-size:.85rem">Top three for three consecutive completed months.</p>
        ${heroes.length ? heroes.map((p) => `<span class="tag hero">${esc(p.name)}</span>`).join("") : "<p>No restaurant has earned this yet.</p>"}
        <h3 style="margin-top:1.2rem">🌱 Consistent contributors</h3>${steady.length ? steady.map((p) => `<span class="tag">${esc(p.name)}</span>`).join("") : "<p>None yet.</p>"}</div>
        <div class="rw-box"><h3>📜 Previous monthly champions</h3><div class="timeline">${champs.map((c) => `<div class="tl"><span>${c.m.label}</span><strong>${esc(c.r.name)}</strong></div>`).join("") || "<p>No completed months yet.</p>"}</div></div></div>`;
  }

  /* ---- Profile modal + sharing ---- */
  function openProfile(rid) {
    const p = PEOPLE.find((x) => x.rid === rid); if (!p) return;
    const a = account(rid), all = stats("all").find((r) => r.rid === rid) || { donations: 0, meals: 0 }, t = CFG.tiers[a.tier];
    const badges = [`${t.icon} ${t.name} tier`]; if (isHero(rid)) badges.push("🦸 Food Rescue Hero"); if (isSteady(rid)) badges.push("🌱 Consistent contributor");
    const hist = done.flatMap((m) => { const w = awards(m.key), out = []; if (w) { if (w.donor.rid === rid) out.push(`${m.label}: Top Food Donor`); if (w.meals.rid === rid) out.push(`${m.label}: Most Meals Rescued`); if (w.steady.rid === rid) out.push(`${m.label}: Consistency Champion`); } return out; });
    $("#profileBody").innerHTML = `<h3>${esc(p.name)}</h3><p>${t.icon} ${t.name} · ${esc(t.title)}</p>
      <div class="pf-grid"><div class="rw-stat"><div><b>${all.donations}</b><span>Verified donations</span></div></div><div class="rw-stat"><div><b>${all.meals}</b><span>Meals rescued</span></div></div></div>
      <p>${badges.map((b) => `<span class="tag">${b}</span>`).join("")}</p><strong>Monthly performance</strong>${monthBars(rid)}
      <strong>Recognition history</strong>${hist.length ? `<div class="timeline">${hist.map((h) => `<div class="tl">${esc(h)}</div>`).join("")}</div>` : "<p>No awards yet.</p>"}
      <p><button class="btn btn-primary" data-share="${rid}">Share Achievement</button></p><p style="font-size:.8rem;color:var(--gray-500)">Demo Data — Not Live Verified Records.</p>`;
    const d = $("#profileDialog"); if (!d.open) (d.showModal ? d.showModal() : d.setAttribute("open", ""));
  }
  async function share(rid) {
    const p = PEOPLE.find((x) => x.rid === rid), s = stats("all").find((r) => r.rid === rid); if (!p || !s) return;
    const text = `${p.name} rescued ${s.meals} meals through ${s.donations} donations on Food Rescue (demo data).`;
    try { if (navigator.share) { await navigator.share({ title: "Food Rescue Champion", text, url: location.href }); return; } } catch (e) { if (e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text} ${location.href}`); toast("Achievement copied to clipboard."); } catch (e) { toast("Could not share or copy. Please copy it manually.", "error"); }
  }

  /* ---- Tabs + init ---- */
  function showTab(name) {
    const board = name === "leaderboard";
    $("#panelRewards").hidden = board; $("#panelBoard").hidden = !board;
    $("#tabRewards").setAttribute("aria-selected", String(!board)); $("#tabBoard").setAttribute("aria-selected", String(board));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  }
  function init() {
    $$("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab(location.hash === "#leaderboard" ? "leaderboard" : "rewards");
    setTimeout(() => {   // brief loading state, then real render
      loadData();
      $("#rwRestaurant").innerHTML = PEOPLE.map((p) => `<option value="${p.rid}">${esc(p.name)}</option>`).join("");
      renderHero(); renderRewards(); renderBoard();
    }, 350);
    $("#rwRestaurant").addEventListener("change", renderRewards);
    document.addEventListener("click", (e) => {
      const g = (a) => e.target.closest(`[${a}]`);
      if (g("data-redeem")) redeem(g("data-redeem").dataset.redeem);
      else if (g("data-profile")) openProfile(g("data-profile").dataset.profile);
      else if (g("data-share")) share(g("data-share").dataset.share);
      else if (g("data-period")) { view.period = g("data-period").dataset.period; renderBoard(); }
      else if (g("data-sort")) { view.sort = g("data-sort").dataset.sort; renderBoard(); }
      else if (g("data-close-dialog")) g("data-close-dialog").closest("dialog").close();
    });
    $("#profileDialog").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
