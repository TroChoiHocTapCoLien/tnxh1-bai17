(function () {
  "use strict";
  // Tiểu học player: the skill's player (exercises choice / sort / input, steps timed to the narration, cover)
  // + video clips from the PPTX with their trim, the "Ong về tổ" game and the "Trồng hoa vào chậu" quiz with sound.
  const C = window.COURSE;
  if (C && C.theme) document.documentElement.setAttribute("data-theme", C.theme); // course.json "theme" → themes.css
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const video = $("video");
  const sfx = new Audio(); // quiz word / game sounds
  const fx = new Audio(); // exercise feedback voice
  const N = C.slides.length;

  // ---------- SCORM 1.2 (falls back to localStorage when opened outside an LMS) ----------
  const LMS = {
    api: null, done: false, t0: Date.now(),
    find(w) {
      for (let i = 0; w && i < 10; i++) {
        try { if (w.API) return w.API; } catch (e) { return null; }
        if (w.parent === w) break;
        w = w.parent;
      }
      return null;
    },
    init() {
      this.api = this.find(window) || (window.opener && this.find(window.opener));
      if (this.api) {
        this.api.LMSInitialize("");
        const st = this.get("cmi.core.lesson_status");
        if (!st || st === "not attempted") this.set("cmi.core.lesson_status", "incomplete");
      }
    },
    get(k) { return this.api ? this.api.LMSGetValue(k) : ""; },
    set(k, v) { if (this.api) this.api.LMSSetValue(k, String(v)); },
    commit() { if (this.api) this.api.LMSCommit(""); },
    finish() {
      if (!this.api || this.done) return;
      this.done = true;
      const s = Math.round((Date.now() - this.t0) / 1000);
      const p = (n) => String(n).padStart(2, "0");
      this.set("cmi.core.session_time", `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`);
      this.set("cmi.core.exit", "suspend");
      this.commit();
      this.api.LMSFinish("");
    },
  };
  const STORE_KEY = "elearning-" + C.id;
  function loadState() {
    let raw = "";
    if (LMS.api) raw = LMS.get("cmi.suspend_data");
    else { try { raw = localStorage.getItem(STORE_KEY) || ""; } catch (e) { raw = ""; } }
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  // saved progress belongs to one page layout: after slides are added, removed or moved (or an exercise changes
  // kind) the old slide numbers mean other pages, so old progress is dropped instead of being applied wrongly
  const LAYOUT = (() => {
    const s = C.slides.map((x) => `${x.title}|${x.practice ? x.practice.type : ""}|${x.quiz ? C.quizStyle || "q" : ""}`).join("~");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  })();
  function saveState() {
    const data = JSON.stringify({ s: state.slide, v: state.visited, q: state.quiz, p: state.practice, L: LAYOUT });
    if (LMS.api) {
      LMS.set("cmi.core.lesson_location", state.slide);
      LMS.set("cmi.suspend_data", data);
      LMS.commit();
    } else { try { localStorage.setItem(STORE_KEY, data); } catch (e) { /* storage unavailable */ } }
  }

  // ---------- state ----------
  const state = { slide: 0, step: 0, visited: [], quiz: null, practice: {}, started: false };
  // an exercise slide keeps its answer step hidden until the child has answered
  const practiceOpen = (i) => { const p = C.slides[i].practice; return !!p && !(state.practice[i] && state.practice[i].done); };
  const autoMax = (p) => (p.autoMax != null ? p.autoMax : p.answerStep - 1);
  const lastAutoStep = (i) => (practiceOpen(i) ? autoMax(C.slides[i].practice) : C.slides[i].steps);
  const imgs = [$("imgA"), $("imgB")];
  let front = 0;
  const src = (i, k) => `slides/s${String(i + 1).padStart(2, "0")}_${k}.jpg`;

  function preload(i) {
    if (i < 0 || i >= N) return;
    for (let k = 0; k <= C.slides[i].steps; k++) { const im = new Image(); im.src = src(i, k); }
    const p = C.slides[i].practice;
    if (p) [p.bg, ...(p.items || []).map((it) => it.src)].filter(Boolean).forEach((u) => { new Image().src = u; });
  }
  function showImage(i, k) {
    const p = C.slides[i].practice;
    // keepBg: the exercise screen stays after it is done (find / match / order show their own answer on it)
    const next = imgs[1 - front], url = p && p.bg && (practiceOpen(i) || p.keepBg) ? p.bg : src(i, k);
    if (imgs[front].getAttribute("src") === url) return;
    next.onload = () => {
      next.classList.add("show");
      imgs[front].classList.remove("show");
      front = 1 - front;
    };
    next.alt = C.slides[i].title;
    next.src = url;
  }

  // ---------- menu ----------
  function buildMenu() {
    const nav = $("menuList");
    C.sections.forEach((sec) => {
      const h = document.createElement("h3");
      h.textContent = sec.title;
      nav.appendChild(h);
      for (let i = sec.from; i <= sec.to; i++) {
        const b = document.createElement("button");
        b.className = "item";
        b.dataset.i = i;
        b.innerHTML = `<span class="num">${i + 1}</span><span></span>`;
        b.lastChild.textContent = C.slides[i].title;
        b.addEventListener("click", () => { go(i, 0, true); closeMenu(); });
        nav.appendChild(b);
      }
    });
  }
  function refreshMenu() {
    document.querySelectorAll(".menu .item").forEach((b) => {
      const i = +b.dataset.i;
      b.classList.toggle("visited", state.visited.includes(i));
      b.classList.toggle("current", i === state.slide);
      if (i === state.slide) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    const ms = $("menuScore");
    if (state.quiz && state.quiz.submitted) {
      ms.hidden = false;
      ms.textContent = `Kết quả kiểm tra: ${state.quiz.score}/${C.quiz.length} ${C.quizStyle === "plant" || qWord() ? "bông hoa" : "câu"} đúng – ${state.quiz.passed ? "Đạt" : "Chưa đạt"}`;
    }
  }
  function openMenu() { $("menu").classList.add("open"); $("scrim").hidden = false; $("menuBtn").setAttribute("aria-expanded", "true"); }
  function closeMenu() { $("menu").classList.remove("open"); $("scrim").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); }

  // ---------- navigation ----------
  function go(i, step, play) {
    if (i < 0 || i >= N) return;
    const s = C.slides[i];
    state.slide = i;
    // an answered exercise reopens on its answer picture; an open one never shows it
    state.step = s.practice && !practiceOpen(i) ? s.practice.answerStep : Math.min(step, lastAutoStep(i));
    if (!state.visited.includes(i)) state.visited.push(i);
    const isQuiz = !!s.quiz;
    $("quiz").hidden = !isQuiz;
    $("stage").classList.toggle("quiz-mode", isQuiz);
    if (isQuiz) renderQuiz(); else showImage(i, state.step);
    $("game").hidden = !s.game;
    if (s.game) renderGame(s.game); else stopGame();
    setupVideo(s);
    sfx.onended = null; sfx.pause();
    fx.onended = null; fx.pause();
    promptPlayed = false;
    renderPractice();
    $("slideTitle").textContent = `${i + 1}. ${s.title}`;
    $("slideText").textContent = s.text;
    $("counter").textContent = `${i + 1} / ${N}`;
    $("progressBar").style.width = `${(state.visited.length / N) * 100}%`;
    $("prevBtn").disabled = i === 0;
    $("nextBtn").disabled = i === N - 1 && state.step >= s.steps;
    $("nextBtn").classList.remove("pulse");
    refreshMenu();
    preload(i); // also this slide's own steps when it was opened from the menu (no wait at each step)
    preload(i + 1);
    audio.src = s.audio;
    audio.currentTime = 0;
    if (play && state.started) audio.play().catch(() => {});
    if (i === N - 1) markComplete();
    saveState();
  }
  function next() {
    if (state.step < lastAutoStep(state.slide)) setStep(state.step + 1);
    else if (state.slide < N - 1) go(state.slide + 1, 0, true);
  }
  function prev() { if (state.slide > 0) go(state.slide - 1, C.slides[state.slide - 1].steps, true); }
  function setStep(k) {
    const s = C.slides[state.slide];
    state.step = Math.min(k, s.steps);
    if (!s.quiz) showImage(state.slide, state.step);
    $("nextBtn").disabled = state.slide === N - 1 && state.step >= s.steps;
    if (s.practice) { $("hotspots").classList.toggle("wait", state.step < autoMax(s.practice)); promptIfReady(); }
  }
  function markComplete() {
    if (!LMS.api) return; // the quiz result (passed / failed) wins over plain completion
    const st = LMS.get("cmi.core.lesson_status");
    if (st !== "passed" && st !== "failed") LMS.set("cmi.core.lesson_status", "completed");
  }

  // ---------- exercises: course.json "practice" ----------
  // done: called once the last clip has ended (or at once when a clip cannot play)
  // each call owns the feedback voice until the next one: a clip cut off by a newer call (AbortError)
  // must not clear the newer call's queue
  let fxToken = 0;
  function playFx(list, done) {
    const q = list.filter(Boolean), my = ++fxToken;
    const step = () => {
      if (my !== fxToken) return;
      if (!q.length) { fx.onended = null; if (done) done(); return; }
      fx.src = q.shift(); fx.onended = step;
      fx.play().catch((e) => {
        if (my !== fxToken || (e && e.name === "AbortError")) return;
        fx.onended = null; if (done) setTimeout(done, 1200); // cannot play (blocked / missing): go on anyway
      });
    };
    audio.pause(); sfx.pause(); fx.pause(); step();
  }
  // "Chính xác!" / "Đúng rồi!" in turn: practiceAudio { words, right: [clip, clip], wrong: clip }
  let praiseTurn = 0, promptPlayed = false;
  function praise() {
    const A = C.practiceAudio || {}, words = A.words || ["Chính xác!"], clips = [].concat(A.right || []);
    const k = praiseTurn++ % words.length;
    return { text: words[k], audio: clips[k % Math.max(1, clips.length)] };
  }
  const pct = (el, box) => { [el.style.left, el.style.top, el.style.width, el.style.height] = box.map((v) => `${v * 100}%`); };
  const practiceState = () => state.practice[state.slide] || (state.practice[state.slide] = { tries: 0, done: false });
  function say(text, cls) { const fb = $("practiceFb"); fb.className = "fb" + (cls ? " " + cls : ""); fb.textContent = text; }
  function promptIfReady() {
    const p = C.slides[state.slide].practice;
    if (p && practiceOpen(state.slide) && state.step >= autoMax(p) && !$("practiceFb").textContent) say(p.prompt || "Bấm vào đáp án em chọn");
  }
  const addToBox = (el) => $("hotspots").insertBefore(el, $("practiceFb"));

  function renderPractice() {
    const s = C.slides[state.slide], p = s.practice, box = $("hotspots"), fb = $("practiceFb");
    [...box.children].forEach((el) => { if (el !== fb) el.remove(); });
    box.classList.remove("picking");
    box.hidden = !p;
    if (!p) return;
    let ps = state.practice[state.slide] || { tries: 0, done: false };
    // progress saved by an older exercise on this slide (the matching one): start the questions afresh
    if ((p.type === "quiz" || p.type === "ask") && ps.done && !ps.ask) { delete state.practice[state.slide]; ps = { tries: 0, done: false }; saveState(); }
    say("");
    // the answer picture has its words elsewhere than the exercise screen: doneFeedbackY keeps the bubble off them
    const fy = ps.done && p.doneFeedbackY != null ? p.doneFeedbackY : p.feedbackY;
    fb.style.top = fy != null ? `${fy * 100}%` : "";
    fb.style.bottom = fy != null ? "auto" : "";
    fb.style.transform = fy != null ? "translate(-50%, -50%)" : "";
    fb.style.left = p.feedbackX != null ? `${p.feedbackX * 100}%` : "";
    box.classList.toggle("wait", state.step < autoMax(p));
    ({ sort: renderSort, input: renderInput, find: renderFind, match: renderMatch, order: renderOrder, ask: renderAsk, quiz: renderAsk }[p.type] || renderChoice)(p, ps);
    if (ps.done) say(p.explain, "ok"); else promptIfReady();
  }
  // silent: the voice was already started (the last sorted word plays its own clip, then the explanation)
  function finishPractice(p, ps, right, silent) {
    ps.done = true;
    setStep(p.answerStep);
    renderPractice();
    if (right && silent) say(p.explain, "ok"); // the last dropped word already got its praise
    else if (right) {
      const pr = p.praise ? { text: p.praise.trim() } : praise();
      say(`${pr.text} ${p.explain}`, "ok");
      if (!silent) playFx([pr.audio, p.explainAudio]);
    } else if (!silent) playFx([p.explainAudio]);
    if (state.slide < N - 1) $("nextBtn").classList.add("pulse");
    saveState();
  }
  function retry(text) { say(text || "Chưa đúng rồi, em thử lại nhé!", "no"); playFx([(C.practiceAudio || {}).wrong]); saveState(); }

  function renderChoice(p, ps) {
    p.options.forEach((o, oi) => {
      const b = document.createElement("button");
      b.className = "hotspot";
      b.setAttribute("aria-label", o.label);
      pct(b, o.box);
      if (ps.done) { b.disabled = true; if (oi === p.answer) b.classList.add("ok"); else b.hidden = true; }
      else if ((ps.wrong || []).includes(oi)) { b.disabled = true; b.classList.add("no"); }
      b.addEventListener("click", () => {
        const st = practiceState();
        if (st.done) return;
        if (oi === p.answer) return finishPractice(p, st, true);
        st.tries++; st.wrong = [...(st.wrong || []), oi];
        if (st.tries >= 2) return finishPractice(p, st, false); // after two wrong tries the answer is shown
        b.disabled = true; b.classList.add("no"); retry(p.hint);
      });
      addToBox(b);
    });
  }

  // sort: items [{label, src, box, bin, audio, say}], bins [{label, name, box, slots}], binScale
  function renderSort(p, ps) {
    if (ps.done) return; // the answer picture shows every word
    const box = $("hotspots"), order = ps.order || [];
    const bins = p.bins.map((bn, bi) => {
      const b = document.createElement("button");
      b.className = "dropbin";
      b.setAttribute("aria-label", bn.label);
      pct(b, bn.box);
      b.addEventListener("click", () => { const sel = box.querySelector(".dragitem.sel"); if (sel) dropItem(sel, bi); });
      addToBox(b);
      return b;
    });
    const hit = (b, e) => { const r = b.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
    p.items.forEach((it) => {
      const el = document.createElement("button");
      el.className = "dragitem";
      el.dataset.label = it.label;
      el.setAttribute("aria-label", `${p.itemName || ""}${it.label}`);
      el.innerHTML = `<img alt="" draggable="false" src="${it.src}">`;
      pct(el, it.box);
      const placed = order.findIndex((o) => o[0] === it.label);
      if (placed >= 0) placeAt(p, it, el, order[placed][1], order.slice(0, placed).filter((o) => o[1] === order[placed][1]).length);
      let drag = null, dragEnd = 0;
      el.addEventListener("pointerdown", (e) => {
        if (el.disabled || e.button > 0) return;
        drag = { x: e.clientX, y: e.clientY, moved: false };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 6) return;
        drag.moved = true;
        el.classList.add("dragging");
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        bins.forEach((b) => b.classList.toggle("over", hit(b, e)));
      });
      const endDrag = (e, cancel) => {
        if (!drag) return;
        const d = drag; drag = null;
        bins.forEach((b) => b.classList.remove("over"));
        if (!d.moved) return; // a tap: the click handler selects it
        dragEnd = performance.now();
        const r = el.getBoundingClientRect(), R = box.getBoundingClientRect();
        el.style.transition = "none"; el.style.transform = "";
        el.style.left = `${((r.left - R.left) / R.width) * 100}%`; el.style.top = `${((r.top - R.top) / R.height) * 100}%`;
        void el.offsetWidth;
        el.style.transition = ""; el.classList.remove("dragging");
        const bi = cancel ? -1 : bins.findIndex((b) => hit(b, e));
        if (bi >= 0) dropItem(el, bi); else pct(el, it.box);
      };
      el.addEventListener("pointerup", (e) => endDrag(e, false));
      el.addEventListener("pointercancel", (e) => endDrag(e, true));
      el.addEventListener("click", () => {
        if (performance.now() - dragEnd < 400) return;
        const was = el.classList.contains("sel");
        box.querySelectorAll(".dragitem.sel").forEach((x) => x.classList.remove("sel"));
        el.classList.toggle("sel", !was);
        box.classList.toggle("picking", !was);
        if (!was) say(p.pickPrompt || "Bây giờ em bấm vào chỗ muốn xếp nhé");
      });
      addToBox(el);
    });
  }
  function placeAt(p, it, el, bi, n) {
    const slots = p.bins[bi].slots, sl = slots[Math.min(n, slots.length - 1)], k = p.binScale || 1;
    pct(el, [sl[0], sl[1], it.box[2] * k, it.box[3] * k]);
    el.disabled = true;
    el.classList.add("in");
    el.style.zIndex = 2 + n;
  }
  function dropItem(el, bi) {
    const i = state.slide, p = C.slides[i].practice, ps = practiceState();
    const it = p.items.find((x) => x.label === el.dataset.label);
    el.classList.remove("sel");
    $("hotspots").classList.remove("picking");
    ps.order = ps.order || [];
    if (it.bin === bi) {
      placeAt(p, it, el, bi, ps.order.filter((o) => o[1] === bi).length);
      ps.order.push([it.label, bi]);
      const pr = praise(), last = ps.order.length === p.items.length;
      say(`${pr.text} ${it.say || `${it.label} là ${p.bins[bi].name}.`}`, "ok"); // "Đúng rồi! Chòi có vần oi."
      playFx([pr.audio, it.audio, last && p.explainAudio]);
      if (last) setTimeout(() => { if (state.slide === i) finishPractice(p, ps, true, true); else { ps.done = true; saveState(); } }, 900);
      saveState();
    } else {
      ps.tries++;
      pct(el, it.box);
      el.classList.remove("no"); void el.offsetWidth; el.classList.add("no");
      retry((p.hint || "").replace("{x}", it.label));
    }
  }

  // input: fields [{label, answer}], box [x, y, w, h]
  function renderInput(p, ps) {
    if (ps.done) return;
    const f = document.createElement("form");
    f.className = "answerform";
    pct(f, p.box);
    p.fields.forEach((fd, k) => {
      const l = document.createElement("label"), sp = document.createElement("span"), inp = document.createElement("input");
      sp.textContent = fd.label;
      Object.assign(inp, { inputMode: "numeric", autocomplete: "off", maxLength: 5, value: (ps.values || [])[k] || "" });
      inp.setAttribute("aria-label", fd.label);
      l.append(sp, inp);
      f.appendChild(l);
    });
    const btn = document.createElement("button");
    btn.type = "submit"; btn.textContent = "Kiểm tra";
    f.appendChild(btn);
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const ins = [...f.querySelectorAll("input")], vals = ins.map((x) => x.value.trim());
      if (vals.some((v) => !v)) return say("Em hãy điền đủ các ô nhé!", "no");
      const st = practiceState();
      st.values = vals;
      const ok = vals.map((v, k) => v === String(p.fields[k].answer));
      ins.forEach((x, k) => x.classList.toggle("bad", !ok[k]));
      if (ok.every(Boolean)) return finishPractice(p, st, true);
      st.tries++;
      if (st.tries >= 2) return finishPractice(p, st, false);
      retry(p.hint);
    });
    addToBox(f);
  }

  // find: tap the words of a text that have the rhyme. lines [["Hà", "hỏi", "mẹ:"], …], box,
  //       targets { "hỏi": { say, audio }, … } (key = the word in lower case without punctuation; every copy counts)
  const wkey = (t) => t.toLowerCase().replace(/[^\p{L}]/gu, "");
  function renderFind(p, ps) {
    const found = ps.found || [], keys = Object.keys(p.targets);
    const card = document.createElement("div");
    card.className = "findtext";
    pct(card, p.box);
    const mark = (k) => card.querySelectorAll(`.fw[data-k="${k}"]`).forEach((x) => x.classList.add("found"));
    p.lines.forEach((ln) => {
      const row = document.createElement("div");
      ln.forEach((tok) => {
        const b = document.createElement("button");
        b.className = "fw"; b.type = "button"; b.textContent = tok; b.dataset.k = wkey(tok);
        if (ps.done) b.disabled = true;
        b.addEventListener("click", () => {
          const st = practiceState(), k = b.dataset.k, t = p.targets[k];
          if (st.done || !k) return;
          st.found = st.found || [];
          if (t && st.found.includes(k)) return playFx([t.audio]); // found already: hear it again
          if (t) {
            st.found.push(k); mark(k);
            const pr = praise(), last = keys.every((x) => st.found.includes(x));
            say(`${pr.text} ${t.say}`, "ok");
            playFx([pr.audio, t.audio, last && p.explainAudio]);
            if (last) setTimeout(() => { if (C.slides[state.slide].practice === p) finishPractice(p, st, true, true); else { st.done = true; saveState(); } }, 900);
            saveState();
          } else {
            st.tries++;
            b.classList.remove("no"); void b.offsetWidth; b.classList.add("no");
            retry(p.hint);
          }
        });
        row.appendChild(b);
        row.appendChild(document.createTextNode(" "));
      });
      card.appendChild(row);
    });
    (ps.done ? keys : found).forEach(mark);
    addToBox(card);
  }

  // match: tap (or drag) a word on the left, then the picture it grows into on the right; a line joins them.
  //        left [{label, box, answer (index in right), say, audio}], right [{label, img, box}]
  function renderMatch(p, ps) {
    const box = $("hotspots"), done = ps.done ? p.left.map((_, k) => k) : ps.matched || [];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mlines"); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
    addToBox(svg);
    const line = (a, b, cls) => {
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      Object.entries({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }).forEach(([k, v]) => l.setAttribute(k, v * 100));
      l.setAttribute("class", cls); svg.appendChild(l); return l;
    };
    const rightEdge = (bx) => [bx[0] + bx[2], bx[1] + bx[3] / 2], leftEdge = (bx) => [bx[0], bx[1] + bx[3] / 2];
    const join = (li) => line(rightEdge(p.left[li].box), leftEdge(p.right[p.left[li].answer].box), "ok");
    let sel = -1, temp = null;
    const lefts = p.left.map((it, li) => {
      const b = document.createElement("button");
      b.className = "mcard" + (it.long ? " long" : ""); b.type = "button"; b.textContent = it.label;
      b.setAttribute("aria-label", it.label);
      pct(b, it.box);
      if (done.includes(li)) { b.classList.add("ok"); b.disabled = true; join(li); }
      b.addEventListener("click", () => {
        if (b.disabled) return;
        lefts.forEach((x) => x.classList.remove("sel"));
        sel = sel === li ? -1 : li;
        b.classList.toggle("sel", sel === li);
        box.classList.toggle("picking", sel >= 0);
        if (sel >= 0) say(p.pickPrompt || "Bây giờ em bấm vào bức tranh khi lớn lên nhé");
      });
      // drag from a word to a picture
      b.addEventListener("pointerdown", (e) => {
        if (b.disabled || e.button > 0) return;
        b.setPointerCapture(e.pointerId);
        const R = box.getBoundingClientRect(), a = rightEdge(it.box);
        const mv = (ev) => {
          const q = [(ev.clientX - R.left) / R.width, (ev.clientY - R.top) / R.height];
          if (Math.hypot((q[0] - a[0]) * R.width, (q[1] - a[1]) * R.height) < 12 && !temp) return;
          if (!temp) temp = line(a, q, "temp");
          temp.setAttribute("x2", q[0] * 100); temp.setAttribute("y2", q[1] * 100);
        };
        const up = (ev) => {
          b.removeEventListener("pointermove", mv); b.removeEventListener("pointerup", up); b.removeEventListener("pointercancel", up);
          if (!temp) return; // a tap: the click handler selects it
          temp.remove(); temp = null;
          const ri = rights.findIndex((r) => { const q = r.getBoundingClientRect(); return ev.clientX >= q.left && ev.clientX <= q.right && ev.clientY >= q.top && ev.clientY <= q.bottom; });
          b.dataset.dragged = performance.now();
          if (ri >= 0) tryMatch(li, ri);
        };
        b.addEventListener("pointermove", mv); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
      });
      addToBox(b);
      return b;
    });
    const rights = p.right.map((it, ri) => {
      const b = document.createElement("button");
      b.className = "mpic"; b.type = "button";
      b.setAttribute("aria-label", it.label);
      b.innerHTML = `<img alt="" draggable="false" src="${it.img}"><span>${it.label}</span>`;
      pct(b, it.box);
      if (p.left.some((l, li) => l.answer === ri && done.includes(li))) b.classList.add("ok");
      b.addEventListener("click", () => { if (sel >= 0 && performance.now() - (+lefts[sel].dataset.dragged || 0) > 400) tryMatch(sel, ri); });
      addToBox(b);
      return b;
    });
    function tryMatch(li, ri) {
      const st = practiceState(), it = p.left[li];
      if (st.done) return;
      lefts.forEach((x) => x.classList.remove("sel")); sel = -1; box.classList.remove("picking");
      st.matched = st.matched || [];
      if (it.answer === ri) {
        st.matched.push(li);
        lefts[li].classList.add("ok"); lefts[li].disabled = true; rights[ri].classList.add("ok");
        join(li);
        const pr = praise(), last = st.matched.length === p.left.length;
        say(`${pr.text} ${it.say}`, "ok");
        playFx([pr.audio, it.audio, last && p.explainAudio]);
        if (last) setTimeout(() => { if (C.slides[state.slide].practice === p) finishPractice(p, st, true, true); else { st.done = true; saveState(); } }, 900);
        saveState();
      } else {
        st.tries++;
        rights[ri].classList.remove("no"); void rights[ri].offsetWidth; rights[ri].classList.add("no");
        retry(p.hint);
      }
    }
  }

  // order: tap the pictures in the order they grow (each goes to the next numbered frame), then choose the rhyme.
  //        items [{label, img, box}] (shown shuffled), slots [[x, y, w, h]…], order [item index…],
  //        then { text, options [..], answer, box, audio }
  function renderOrder(p, ps) {
    const placed = ps.done ? p.order.slice() : ps.placed || [];
    p.items.forEach((it, k) => {
      const b = document.createElement("button");
      b.className = "ocard"; b.type = "button";
      b.setAttribute("aria-label", it.label);
      b.innerHTML = `<img alt="" draggable="false" src="${it.img}"><span>${it.label}</span>`;
      const at = placed.indexOf(k);
      pct(b, at >= 0 ? p.slots[at] : it.box);
      if (at >= 0) { b.classList.add("in"); b.disabled = true; }
      b.addEventListener("click", () => {
        const st = practiceState();
        if (st.done || b.disabled) return;
        st.placed = st.placed || [];
        const n = st.placed.length;
        if (p.order[n] === k) {
          st.placed.push(k);
          pct(b, p.slots[n]); b.classList.add("in"); b.disabled = true;
          const pr = praise(), last = st.placed.length === p.order.length;
          say(last ? `${pr.text} ${p.orderSay}` : `${pr.text} ${it.say}`, "ok");
          if (last && !p.then) { // no follow-up question: ordering it is the whole exercise
            playFx([pr.audio, p.explainAudio]);
            setTimeout(() => { if (C.slides[state.slide].practice === p) finishPractice(p, st, true, true); else { st.done = true; saveState(); } }, 900);
            saveState();
            return;
          }
          playFx([pr.audio, last ? p.then.audio : null]);
          if (last) showThen(p, st);
          saveState();
        } else {
          st.tries++;
          b.classList.remove("no"); void b.offsetWidth; b.classList.add("no");
          retry(p.hint);
        }
      });
      addToBox(b);
    });
    if (placed.length === p.order.length && p.then) showThen(p, ps);
  }
  function showThen(p, ps) {
    const t = p.then, box = document.createElement("div");
    box.className = "thenbox";
    pct(box, t.box);
    const q = document.createElement("p"); q.innerHTML = t.text; box.appendChild(q);
    const row = document.createElement("div");
    t.options.forEach((o, oi) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "vbtn"; b.textContent = o;
      if (ps.done) { b.disabled = true; if (oi === t.answer) b.classList.add("ok"); }
      else if ((ps.wrong || []).includes(oi)) { b.disabled = true; b.classList.add("no"); }
      b.addEventListener("click", () => {
        const st = practiceState();
        if (st.done) return;
        if (oi === t.answer) return finishPractice(p, st, true);
        st.tries++; st.wrong = [...(st.wrong || []), oi];
        if (st.wrong.length >= 2) return finishPractice(p, st, false);
        b.disabled = true; b.classList.add("no"); retry(t.hint);
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    addToBox(box);
  }

  // quiz: questions one after another, each with big pictures to tap.
  //       questions [{q, audio, options [{label, img}], answer, say, sayAudio}], head [x,y,w,h], pics [[x,y,w,h]…]
  //       done: summary [{img, text}] shown in the pics boxes
  function renderAsk(p, ps) { // (renderQuiz is the end-of-lesson quiz)
    const qs = p.questions, qi = Math.min(ps.qi || 0, qs.length - 1), Q = qs[qi];
    p.promptAudio = Q.audio; // the end of the narration (or a reload) asks the current question
    if (ps.done) {
      p.summary.forEach((it, k) => {
        const c = document.createElement("div");
        c.className = "askpic ok";
        c.innerHTML = `<img alt="" src="${it.img}"><span>${it.text}</span>`;
        pct(c, p.pics[k]);
        addToBox(c);
      });
      return;
    }
    const head = document.createElement("div");
    head.className = "askhead";
    pct(head, p.head);
    head.innerHTML = `<span class="askcount">Câu ${qi + 1}/${qs.length}</span><span class="asktext">${Q.q}</span>`;
    const again = document.createElement("button");
    again.type = "button"; again.className = "asksay"; again.setAttribute("aria-label", "Nghe lại câu hỏi"); again.textContent = "🔊";
    again.addEventListener("click", () => playFx([Q.audio]));
    head.appendChild(again);
    addToBox(head);
    const wrong = (ps.wrong || {})[qi] || [];
    let busy = false;
    const advance = (st) => {
      if (C.slides[state.slide].practice !== p) return;
      if (qi + 1 < qs.length) {
        st.qi = qi + 1; saveState(); renderPractice();
        say(p.prompt); playFx([qs[qi + 1].audio]);
      } else { st.ask = true; finishPractice(p, st, true, true); }
    };
    const btns = Q.options.map((o, oi) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "askpic";
      b.setAttribute("aria-label", o.label);
      b.innerHTML = `<img alt="" draggable="false" src="${o.img}"><span>${o.label}</span>`;
      pct(b, p.pics[oi]);
      if (wrong.includes(oi)) { b.disabled = true; b.classList.add("no"); }
      b.addEventListener("click", () => {
        const st = practiceState();
        if (st.done || busy || b.disabled) return;
        st.wrong = st.wrong || {};
        const w = st.wrong[qi] = st.wrong[qi] || [];
        if (oi === Q.answer || w.length >= 1) { // right, or a second wrong try: show the answer
          busy = true;
          const right = oi === Q.answer;
          if (!right) { st.tries++; b.disabled = true; b.classList.add("no"); }
          btns[Q.answer].classList.add("ok");
          btns.forEach((x, k) => { if (k !== Q.answer) x.classList.add("dim"); });
          const pr = right ? praise() : { text: "Đáp án là:" };
          say(`${pr.text} ${Q.say}`, "ok");
          playFx([pr.audio, Q.sayAudio], () => setTimeout(() => advance(st), 500));
          saveState();
          return;
        }
        st.tries++; w.push(oi);
        b.disabled = true; b.classList.add("no");
        retry(p.hint);
      });
      addToBox(b);
      return b;
    });
  }

  // ---------- narration: steps appear as the voice names them ----------
  function narrationTick() {
    const s = C.slides[state.slide], d = audio.duration || s.duration;
    if (d) {
      const f = audio.currentTime / d;
      // "reveal": second at which each step appears (course.json "timing", set_timing.js); else spread evenly
      let due = s.reveal ? s.reveal.filter((t) => audio.currentTime >= t).length : Math.floor(f * (s.steps + 1));
      due = Math.min(due, lastAutoStep(state.slide));
      if (due > state.step && !s.quiz) setStep(due);
      $("seek").value = Math.round((audio.currentTime / d) * 1000);
    }
    $("timeLabel").textContent = `${fmt(audio.currentTime)} / ${fmt(d)}`;
  }
  // "timeupdate" comes only every ~0.25 s: too late for letters read 0.3 s apart ("o – i – oi"),
  // so while the voice plays the steps are also checked every frame
  audio.addEventListener("timeupdate", narrationTick);
  let tickLoop = 0;
  const frameTick = () => { tickLoop = 0; if (audio.paused || audio.ended) return; narrationTick(); tickLoop = requestAnimationFrame(frameTick); };
  audio.addEventListener("playing", () => { if (!tickLoop) tickLoop = requestAnimationFrame(frameTick); });
  audio.addEventListener("play", () => { $("playBtn").classList.add("playing"); video.pause(); });
  audio.addEventListener("pause", () => $("playBtn").classList.remove("playing"));
  audio.addEventListener("ended", () => {
    const s = C.slides[state.slide];
    if (!s.quiz) setStep(lastAutoStep(state.slide));
    if (practiceOpen(state.slide)) { // wait for the child's answer; say once what to do
      const p = s.practice;
      // not once the child has started (a feedback voice would be cut and its "done" step lost)
      if (p.promptAudio && !promptPlayed && fx.paused && !state.practice[state.slide]) { promptPlayed = true; playFx([p.promptAudio]); }
      return;
    }
    if (s.video) { playVideo(); return; } // the clip follows the narration
    if (s.game) { if (!game.finished) $("game").classList.add("hint"); return; } // wait for the child to play
    slideDone();
  });
  function slideDone() {
    const s = C.slides[state.slide];
    if ($("autoNext").checked && !s.quiz && state.slide < N - 1) setTimeout(() => go(state.slide + 1, 0, true), 1200);
    else if (state.slide < N - 1) $("nextBtn").classList.add("pulse");
  }
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

  // ---------- "Ong về tổ": tap a bee -> its word appears on the sign, the teacher reads it, the bee flies home ----------
  const game = { cfg: null, done: 0, busy: false, finished: false, timer: 0 };
  function stopGame() { clearTimeout(game.timer); game.cfg = null; }
  function renderGame(cfg) {
    if (cfg.type === "flowers") return renderFlowers(cfg);
    stopGame();
    Object.assign(game, { cfg, done: 0, busy: false, finished: false });
    const box = $("game");
    box.className = "game";
    box.innerHTML = "";
    const bg = document.createElement("img"); bg.className = "g-bg"; bg.src = cfg.bg; bg.alt = ""; box.appendChild(bg);
    const word = document.createElement("div"); word.className = "g-word"; word.setAttribute("aria-live", "assertive");
    const wb = cfg.wordBox;
    Object.assign(word.style, { left: wb.x + "%", top: wb.y + "%", width: wb.w + "%", height: wb.h + "%" });
    box.appendChild(word);
    const score = document.createElement("div"); score.className = "g-score";
    score.innerHTML = cfg.bees.map(() => '<i class="g-star">★</i>').join("");
    box.appendChild(score);
    const tip = document.createElement("div"); tip.className = "g-tip"; tip.textContent = "👆 Bấm vào từng chú ong!"; box.appendChild(tip);
    cfg.bees.forEach((b, k) => {
      const btn = document.createElement("button");
      btn.className = "g-bee";
      btn.setAttribute("aria-label", `Chú ong số ${k + 1}`);
      const S = 1.5, cx = b.x + b.w / 2, cy = b.y + b.h / 2; // bigger tap target around the bee
      Object.assign(btn.style, { left: cx - (b.w * S) / 2 + "%", top: cy - (b.h * S) / 2 + "%", width: b.w * S + "%", height: b.h * S + "%", animationDelay: `${-k * 0.37}s` });
      const img = document.createElement("img"); img.src = b.img; img.alt = "";
      img.style.transform = `rotate(${b.rot || 0}deg)${b.flip ? " scaleX(-1)" : ""}`;
      btn.appendChild(img);
      btn.addEventListener("click", () => tapBee(btn, b, word, score));
      box.appendChild(btn);
    });
    const again = document.createElement("button"); again.className = "g-again"; again.textContent = "↻ Chơi lại"; again.hidden = true;
    again.addEventListener("click", () => renderGame(cfg));
    box.appendChild(again);
  }
  function tapBee(btn, b, word, score) {
    if (game.busy || btn.classList.contains("home")) return;
    game.busy = true;
    const box = $("game");
    box.classList.remove("hint");
    box.classList.add("played");
    audio.pause();
    word.textContent = b.word;
    word.classList.remove("pop"); void word.offsetWidth; word.classList.add("pop");
    btn.classList.add("talking");
    let flown = false;
    const fly = () => {
      if (flown || game.cfg !== C.slides[state.slide].game) return;
      flown = true;
      sfx.onended = null;
      btn.classList.remove("talking");
      btn.classList.add("home");
      const h = game.cfg.hole, w = parseFloat(btn.style.width), ht = parseFloat(btn.style.height);
      btn.style.left = h.x - w / 2 + "%"; btn.style.top = h.y - ht / 2 + "%";
      game.done++;
      score.children[game.done - 1].classList.add("on");
      game.timer = setTimeout(() => {
        game.busy = false;
        if (game.done === game.cfg.bees.length) finishGame();
      }, 1300);
    };
    sfx.onended = () => { game.timer = setTimeout(fly, 400); };
    playSfx(b.audio);
    game.timer = setTimeout(fly, 6000); // safety net if the sound cannot play
  }
  // ---------- "Mở hoa, đọc từ": tap a flower -> it turns over to its word (rhyme in red), the teacher reads it ----------
  function renderFlowers(cfg) {
    stopGame();
    Object.assign(game, { cfg, done: 0, busy: false, finished: false });
    const box = $("game");
    box.className = "game flowers";
    box.innerHTML = "";
    const bg = document.createElement("img"); bg.className = "g-bg"; bg.src = cfg.bg; bg.alt = ""; box.appendChild(bg);
    const score = document.createElement("div"); score.className = "g-score";
    score.innerHTML = cfg.flowers.map(() => '<i class="g-star">★</i>').join("");
    box.appendChild(score);
    const tip = document.createElement("div"); tip.className = "g-tip"; tip.textContent = cfg.tip || "👆 Bấm vào từng bông hoa!"; box.appendChild(tip);
    // "nhà m[ới]" -> the bracketed letters in red
    const wordHtml = (w) => w.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\[([^\]]+)\]/g, '<b>$1</b>');
    cfg.flowers.forEach((f, k) => {
      const btn = document.createElement("button");
      btn.className = "g-flower";
      btn.setAttribute("aria-label", `Bông hoa số ${f.n}`);
      Object.assign(btn.style, { left: f.x + "%", top: f.y + "%", width: f.w + "%", height: f.h + "%", animationDelay: `${-k * 0.45}s` });
      btn.innerHTML = `<span class="g-card"><span class="g-front"><img src="${f.img}" alt=""><i class="g-num">${f.n}</i></span>` +
        `<span class="g-back"><span class="g-text">${wordHtml(f.word)}</span></span></span>`;
      btn.addEventListener("click", () => tapFlower(btn, f, score));
      box.appendChild(btn);
    });
    const again = document.createElement("button"); again.className = "g-again"; again.textContent = "↻ Chơi lại"; again.hidden = true;
    again.addEventListener("click", () => renderFlowers(cfg));
    box.appendChild(again);
  }
  function tapFlower(btn, f, score) {
    const cfg = game.cfg;
    if (btn.classList.contains("open")) { if (!game.busy) playSfx(f.audio); return; } // tap an open flower: hear it again
    if (game.busy) return;
    game.busy = true;
    const box = $("game");
    box.classList.remove("hint");
    box.classList.add("played");
    btn.classList.add("open", "talking");
    game.done++;
    score.children[game.done - 1].classList.add("on");
    let ended = false;
    const end = () => {
      if (ended || game.cfg !== cfg) return;
      ended = true;
      sfx.onended = null;
      btn.classList.remove("talking");
      game.busy = false;
      if (game.done === cfg.flowers.length) game.timer = setTimeout(finishGame, 500);
    };
    sfx.onended = () => { game.timer = setTimeout(end, 250); };
    playSfx(f.audio);
    game.timer = setTimeout(end, 7000); // safety net if the sound cannot play
  }
  function finishGame() {
    game.finished = true;
    const box = $("game");
    box.classList.add("won");
    const cheer = document.createElement("div"); cheer.className = "g-cheer";
    cheer.innerHTML = `<span>🎉</span> Giỏi lắm! <span>${game.cfg.type === "flowers" ? "🌸" : "🐝"}</span>`;
    box.appendChild(cheer);
    box.querySelector(".g-again").hidden = false;
    sfx.onended = () => { sfx.onended = null; slideDone(); };
    playSfx(game.cfg.done);
  }

  // ---------- video slides (clip from the PPTX, with its trim) ----------
  let videoEnd = 0, videoSlide = -1;
  function setupVideo(s) {
    video.pause();
    $("videoBtn").hidden = !s.video;
    if (!s.video) { video.hidden = true; videoSlide = -1; return; }
    const v = s.video, b = v.box;
    Object.assign(video.style, { left: b.x + "%", top: b.y + "%", width: b.w + "%", height: b.h + "%" });
    video.hidden = true;
    videoSlide = state.slide;
    if (video.getAttribute("src") !== v.src) video.src = v.src;
    const seekStart = () => { videoEnd = v.trimEnd ? video.duration - v.trimEnd : video.duration; try { video.currentTime = v.start || 0; } catch (e) { /* not seekable yet */ } };
    if (video.readyState >= 1) seekStart(); else video.addEventListener("loadedmetadata", seekStart, { once: true });
  }
  function playVideo() {
    const s = C.slides[state.slide];
    if (!s.video) return;
    audio.pause();
    video.hidden = false;
    if (video.currentTime >= videoEnd - 0.2) video.currentTime = s.video.start || 0;
    video.play().catch(() => {});
  }
  let clipDone = false;
  function clipEnd() { if (clipDone || videoSlide !== state.slide) return; clipDone = true; video.pause(); slideDone(); }
  video.addEventListener("timeupdate", () => { if (videoEnd && video.currentTime >= videoEnd) clipEnd(); });
  video.addEventListener("ended", clipEnd);
  video.addEventListener("play", () => { clipDone = false; audio.pause(); });
  $("videoBtn").addEventListener("click", playVideo);

  // ---------- quiz "plant": Trồng hoa vào chậu ----------
  // Each flower carries a word (tap it or its speaker to hear it); plant it in the pot of its rhyme by tapping the
  // flower then the pot, or by dragging it. All planted -> "Nộp bài" scores like the plain quiz (answers[i] = pot).
  // Layout in % of the box: wide 16:9 inside the stage, "tall" 4:5 on phones so words stay big enough to read.
  const PL = {
    wide: { r: 16 / 9, fw: 12, gx: [10, 26, 42, 58, 74, 90], gy: [14, 14, 14, 14, 14, 14], pw: 24, px: [18, 50, 82], py: 66, sw: 9.5, sink: 0.2, gap: 8, top: 13 },
    tall: { r: 4 / 5, fw: 21, gx: [18, 50, 82, 18, 50, 82], gy: [16, 16, 16, 41.5, 41.5, 41.5], pw: 31, px: [17, 50, 83], py: 80.5, sw: 15, sink: 0.25, gap: 10, top: 14 },
  };
  const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const flowerSvg = (word) => `<svg viewBox="0 0 100 150" aria-hidden="true">
    <path d="M50 74 V150" stroke="#2E7D32" stroke-width="6"/>
    <path d="M50 118 C30 100 12 108 6 122 C26 130 40 126 50 118Z" fill="#43A047"/>
    <path d="M50 104 C70 86 88 94 94 108 C74 116 60 112 50 104Z" fill="#388E3C"/>
    ${Array.from({ length: 14 }, (_, k) => `<ellipse cx="50" cy="20" rx="8.5" ry="18" fill="${k % 2 ? "#FBC02D" : "#FFE04B"}" stroke="#F9A825" stroke-width="1" transform="rotate(${(k * 360) / 14} 50 50)"/>`).join("")}
    <circle cx="50" cy="50" r="27" fill="#7B4F2E" stroke="#4E342E" stroke-width="2"/>
    <text x="50" y="58" text-anchor="middle" font-size="23" font-weight="700" fill="#fff" font-family="Segoe UI, Arial, sans-serif">${escH(word)}</text></svg>`;
  const potBack = `<svg viewBox="0 0 200 150" aria-hidden="true"><ellipse cx="100" cy="22" rx="90" ry="13" fill="#5D4037"/></svg>`;
  const potFront = (label) => `<svg viewBox="0 0 200 150" aria-hidden="true">
    <path d="M16 38 L184 38 L160 148 L40 148 Z" fill="#E8641C" stroke="#A33F0B" stroke-width="3"/>
    <rect x="2" y="14" width="196" height="28" rx="7" fill="#F57C2A" stroke="#A33F0B" stroke-width="3"/>
    <text x="100" y="116" text-anchor="middle" font-size="60" font-weight="700" fill="#FFF8E1" font-family="Segoe UI, Arial, sans-serif">${escH(label)}</text></svg>`;
  const speakerSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff" stroke="none"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
  let plant = null; // { box, L, sel, drag, fls: [wrap], pots: [{btn, front}] }
  const tallLayout = () => window.matchMedia("(max-width: 600px)").matches;
  window.addEventListener("resize", () => {
    if (plant && C.slides[state.slide].quiz && (plant.L === PL.tall) !== tallLayout()) renderQuiz();
  });

  function renderPlant() {
    const q = state.quiz || (state.quiz = { answers: Array(C.quiz.length).fill(null), submitted: false });
    const box = $("quiz"), L = tallLayout() ? PL.tall : PL.wide, opts = C.quiz[0].options;
    box.innerHTML = "";
    box.className = "quiz plant" + (L === PL.tall ? " tall" : "");
    plant = { box, L, sel: null, drag: null, fls: [], pots: [] };
    const top = document.createElement("div"); top.className = "pl-top";
    top.innerHTML = `<h2></h2><span class="pl-count" aria-live="polite"></span>`;
    top.firstChild.textContent = C.slides[state.slide].title.replace(/^Trò chơi:\s*/, "");
    const submit = document.createElement("button"); submit.className = "primary pl-submit"; submit.textContent = "Nộp bài";
    submit.addEventListener("click", submitQuiz);
    top.appendChild(submit);
    box.appendChild(top);
    plant.count = top.querySelector(".pl-count"); plant.submit = submit;
    // pots: the back (soil, also the tap target) under the flowers, the front over their stems
    opts.forEach((label, p) => {
      const btn = document.createElement("button"); btn.className = "pl-pot"; btn.innerHTML = potBack;
      btn.setAttribute("aria-label", `Chậu vần ${label}`);
      const front = document.createElement("div"); front.className = "pl-front"; front.innerHTML = potFront(label);
      for (const el of [btn, front]) {
        el.style.left = `${L.px[p] - L.pw / 2}%`; el.style.top = `${L.py}%`;
        el.style.width = `${L.pw}%`; el.style.height = `${L.pw * 0.75 * L.r}%`;
      }
      btn.addEventListener("click", () => plTapPot(p));
      box.appendChild(btn); box.appendChild(front);
      plant.pots.push({ btn, front });
    });
    C.quiz.forEach((item, qi) => {
      const wrap = document.createElement("div"); wrap.className = "pl-fl";
      const head = document.createElement("button"); head.className = "pl-head"; head.innerHTML = flowerSvg(item.word);
      head.setAttribute("aria-label", `Bông hoa: ${item.word}`);
      const say = document.createElement("button"); say.className = "pl-say"; say.innerHTML = speakerSvg;
      say.setAttribute("aria-label", `Nghe tiếng ${item.word}`);
      say.addEventListener("click", (e) => { e.stopPropagation(); plHear(qi); });
      const mark = document.createElement("span"); mark.className = "pl-mark"; mark.setAttribute("aria-hidden", "true");
      wrap.append(head, say, mark);
      head.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;
        const r = box.getBoundingClientRect(), fr = wrap.getBoundingClientRect();
        plant.drag = { qi, x0: e.clientX, y0: e.clientY, dx: e.clientX - fr.left, dy: e.clientY - fr.top, r, moved: false, id: e.pointerId };
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ } // fast drags leave the flower at once
      });
      head.addEventListener("pointermove", (e) => {
        const d = plant.drag;
        if (!d || d.qi !== qi || q.submitted) return;
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return;
          d.moved = true; wrap.classList.add("dragging"); plSelect(qi, false);
        }
        wrap.style.left = `${((e.clientX - d.dx - d.r.left) / d.r.width) * 100}%`;
        wrap.style.top = `${((e.clientY - d.dy - d.r.top) / d.r.height) * 100}%`;
        const p = plPotAt(e.clientX, e.clientY);
        plant.pots.forEach((pt, k) => pt.front.classList.toggle("over", k === p));
      });
      const end = (e) => {
        const d = plant.drag;
        if (!d || d.qi !== qi) return;
        plant.drag = null;
        wrap.classList.remove("dragging");
        plant.pots.forEach((pt) => pt.front.classList.remove("over"));
        if (!d.moved) { if (e.type === "pointerup") plTapFlower(qi); return; }
        const p = e.type === "pointerup" ? plPotAt(e.clientX, e.clientY) : null;
        if (p != null) plPutIn(qi, p); else layoutPlant();
      };
      head.addEventListener("pointerup", end);
      head.addEventListener("pointercancel", end);
      head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); plTapFlower(qi); } });
      box.appendChild(wrap);
      plant.fls.push(wrap);
    });
    if (q.submitted) showPlantResult();
    layoutPlant();
  }
  function plHear(qi) { if (C.quizAudio) playSfx(`audio/quiz/q${qi + 1}.mp3`); }
  function plSelect(qi, sound) {
    plant.sel = qi;
    plant.fls.forEach((w, k) => { w.classList.toggle("sel", k === qi); w.firstChild.setAttribute("aria-pressed", String(k === qi)); });
    plant.pots.forEach((pt) => pt.front.classList.toggle("ready", qi != null));
    if (sound && qi != null) plHear(qi);
    updatePlantBar();
  }
  function plTapFlower(qi) {
    const q = state.quiz;
    if (q.submitted) { plHear(qi); return; }
    if (q.answers[qi] != null) { q.answers[qi] = null; saveState(); plSelect(qi, true); layoutPlant(); return; } // take it back out
    plSelect(plant.sel === qi ? null : qi, plant.sel !== qi);
  }
  function plTapPot(p) {
    const q = state.quiz;
    if (q.submitted) return;
    if (plant.sel == null) { plant.count.textContent = "Em chọn một bông hoa trước nhé!"; plant.count.classList.add("warn"); return; }
    plPutIn(plant.sel, p);
  }
  function plPutIn(qi, p) {
    state.quiz.answers[qi] = p;
    saveState();
    plSelect(null, false);
    layoutPlant();
  }
  function plPotAt(x, y) { // a pot catches a flower dropped on it or just above it (where planted flowers stand)
    let hit = null;
    plant.pots.forEach((pt, k) => {
      const r = pt.front.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - r.height * 0.8 && y <= r.bottom) hit = k;
    });
    return hit;
  }
  function layoutPlant() {
    const q = state.quiz, L = plant.L;
    const fh = (w) => w * 1.5 * L.r; // flower height in % of the box height
    C.quiz[0].options.forEach((_, p) => {
      const here = q.answers.map((a, qi) => (a === p ? qi : -1)).filter((qi) => qi >= 0);
      // up to 3 flowers stand in one row; more (a child may put many in one pot) stand in two rows:
      // the back row a little higher and half a place aside, so every word stays readable
      const back = here.length > 3 ? Math.ceil(here.length / 2) : here.length;
      const rows = [here.slice(0, back), here.slice(back)];
      const bottom = L.py + L.pw * 0.75 * L.r * L.sink;
      rows.forEach((row, ri) => {
        const two = rows[1].length > 0, step = row.length > 1 ? Math.min(L.gap, (L.pw * 0.92) / (row.length - 1)) : 0;
        row.forEach((qi, k) => {
          const w = plant.fls[qi];
          const cx = L.px[p] + (k - (row.length - 1) / 2) * step + (two ? (ri ? 0.25 : -0.25) * step : 0);
          const lift = two && ri === 0 ? fh(L.sw) * 0.4 : 0;
          Object.assign(w.style, { left: `${cx - L.sw / 2}%`, top: `${bottom - fh(L.sw) - lift}%`, width: `${L.sw}%`, height: `${fh(L.sw)}%`, zIndex: 2 + ri * 3 + k });
          w.classList.add("planted");
        });
      });
    });
    q.answers.forEach((a, qi) => {
      if (a != null) return;
      const w = plant.fls[qi];
      Object.assign(w.style, { left: `${L.gx[qi] - L.fw / 2}%`, top: `${L.gy[qi]}%`, width: `${L.fw}%`, height: `${fh(L.fw)}%`, zIndex: "" });
      w.classList.remove("planted");
    });
    plant.fls.forEach((w, qi) => {
      const ok = q.submitted && q.answers[qi] === C.quiz[qi].answer;
      w.classList.toggle("right", q.submitted && ok);
      w.classList.toggle("wrong", q.submitted && !ok);
      w.lastChild.textContent = q.submitted ? (ok ? "✓" : "✗") : "";
    });
    updatePlantBar();
  }
  function updatePlantBar() {
    const q = state.quiz, n = q.answers.filter((a) => a != null).length, all = C.quiz.length;
    plant.count.classList.remove("warn");
    plant.count.textContent = q.submitted ? `Đúng ${q.score}/${all} bông hoa`
      : plant.sel != null ? `Bấm vào chậu có vần của tiếng “${C.quiz[plant.sel].word}”`
      : n < all ? `Đã trồng ${n}/${all} bông hoa` : "Trồng xong rồi! Bấm Nộp bài nhé.";
    plant.submit.hidden = q.submitted;
    plant.submit.disabled = n < all;
    plant.box.classList.toggle("done", !!q.submitted);
  }
  function showPlantResult() {
    const q = state.quiz, res = document.createElement("div");
    res.className = "pl-result " + (q.passed ? "pass" : "fail");
    const wrong = C.quiz.filter((it, i) => q.answers[i] !== it.answer);
    res.innerHTML = `<div class="pl-row"><p><span class="pl-stars" aria-hidden="true"></span> <b></b></p></div>${wrong.length ? "<ul></ul>" : ""}`;
    res.querySelector(".pl-stars").textContent = "⭐".repeat(q.score) + "☆".repeat(C.quiz.length - q.score);
    res.querySelector("b").textContent = `Em trồng đúng ${q.score}/${C.quiz.length} bông hoa. ` + (q.passed ? "Đạt rồi! Bấm Tiếp để kết thúc bài." : "Chưa đạt, em trồng lại nhé.");
    for (const it of wrong) {
      const li = document.createElement("li"); li.textContent = `${it.word} → chậu vần ${it.options[it.answer]} (${it.explain})`;
      res.querySelector("ul").appendChild(li);
    }
    const again = document.createElement("button"); again.className = "primary pl-again"; again.textContent = "Làm lại";
    again.addEventListener("click", () => { state.quiz = null; renderQuiz(); saveState(); });
    res.querySelector(".pl-row").appendChild(again);
    plant.box.appendChild(res);
  }

  // ---------- quiz: plain cards (one card per question) ----------
  // bài kiểm tra theo tiếng / vần (Tiếng Việt: item.word) hay câu hỏi thường (TN-XH…)
  function qWord() { return C.quiz.some((x) => x.word); }
  function renderQuiz() {
    if (C.quizStyle === "plant") return renderPlant();
    $("quiz").className = "quiz" + (qWord() ? "" : " qtext");
    const q = state.quiz || (state.quiz = { answers: Array(C.quiz.length).fill(null), submitted: false });
    const box = $("quiz");
    box.innerHTML = "";
    const h = document.createElement("h2"); h.textContent = C.slides[state.slide].title; box.appendChild(h);
    const lead = document.createElement("p"); lead.className = "lead";
    lead.textContent = qWord() ? `Bấm 🔊 để nghe tiếng, rồi chọn vần đúng cho mỗi bông hoa. Đúng từ ${C.passCount}/${C.quiz.length} bông hoa là đạt.` : `Bấm 🔊 để nghe câu hỏi, rồi chọn đáp án đúng. Đúng từ ${C.passCount}/${C.quiz.length} câu là đạt.`;
    box.appendChild(lead);
    const grid = document.createElement("div"); grid.className = "grid"; box.appendChild(grid);
    C.quiz.forEach((item, qi) => {
      const card = document.createElement("div");
      card.className = "q" + (q.submitted ? (q.answers[qi] === item.answer ? " right" : " wrong") : "");
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", `${qi + 1}. ${item.q}`);
      const head = document.createElement("div"); head.className = "qhead"; card.appendChild(head);
      const flower = document.createElement("span"); flower.className = "flower"; flower.textContent = item.word || item.q; head.appendChild(flower);
      if (C.quizAudio) {
        const sp = document.createElement("button"); sp.className = "speak"; sp.setAttribute("aria-label", `Nghe: ${item.q}`); sp.textContent = "🔊";
        sp.addEventListener("click", () => playSfx(`audio/quiz/q${qi + 1}.mp3`));
        head.appendChild(sp);
      }
      const opts = document.createElement("div"); opts.className = "opts"; card.appendChild(opts);
      item.options.forEach((o, oi) => {
        const b = document.createElement("button");
        b.textContent = item.word ? o : `${"ABCD"[oi]}. ${o}`;
        b.setAttribute("aria-pressed", String(q.answers[qi] === oi));
        if (q.submitted) {
          b.disabled = true;
          if (oi === item.answer) b.classList.add("ok");
          else if (oi === q.answers[qi]) b.classList.add("no");
        } else if (q.answers[qi] === oi) b.classList.add("sel");
        b.addEventListener("click", () => { q.answers[qi] = oi; renderQuiz(); saveState(); });
        opts.appendChild(b);
      });
      if (q.submitted) {
        const e = document.createElement("p"); e.className = "exp";
        e.textContent = (q.answers[qi] === item.answer ? "⭐ Đúng rồi! " : (item.word ? `Chưa đúng – vần ${item.options[item.answer]}. ` : `Chưa đúng – đáp án: ${item.options[item.answer]}. `)) + item.explain;
        card.appendChild(e);
      }
      grid.appendChild(card);
    });
    const act = document.createElement("div"); act.className = "actions"; box.appendChild(act);
    const btn = document.createElement("button"); btn.className = "primary";
    if (!q.submitted) {
      btn.textContent = "Nộp bài";
      btn.disabled = q.answers.some((a) => a === null);
      btn.addEventListener("click", submitQuiz);
      act.appendChild(btn);
      if (btn.disabled) { const hint = document.createElement("span"); hint.className = "result"; hint.textContent = `Hãy chọn đủ ${C.quiz.length} ${qWord() ? "bông hoa" : "câu"} nhé.`; act.appendChild(hint); }
    } else {
      const r = document.createElement("span");
      r.className = "result " + (q.passed ? "pass" : "fail");
      r.textContent = `Em đúng ${q.score}/${C.quiz.length} ${qWord() ? "bông hoa" : "câu"} ${"⭐".repeat(q.score)} – ${q.passed ? "Đạt rồi! Bấm Tiếp để kết thúc bài." : "Chưa đạt, em xem lại rồi bấm Làm lại nhé."}`;
      btn.textContent = "Làm lại";
      btn.addEventListener("click", () => { state.quiz = null; renderQuiz(); saveState(); });
      act.appendChild(btn);
      act.appendChild(r);
    }
  }
  function submitQuiz() {
    const q = state.quiz;
    q.score = C.quiz.reduce((n, item, i) => n + (q.answers[i] === item.answer ? 1 : 0), 0);
    q.passed = q.score >= C.passCount;
    q.submitted = true;
    if (LMS.api) {
      LMS.set("cmi.core.score.min", 0);
      LMS.set("cmi.core.score.max", 100);
      LMS.set("cmi.core.score.raw", Math.round((q.score / C.quiz.length) * 100));
      LMS.set("cmi.core.lesson_status", q.passed ? "passed" : "failed");
    }
    renderQuiz();
    refreshMenu();
    saveState();
    if (C.quizAudio) playSfx(`audio/quiz/${q.passed ? "pass" : "fail"}.mp3`);
    if (q.passed) $("nextBtn").classList.add("pulse");
  }
  function playSfx(url) { audio.pause(); fx.pause(); sfx.src = url; sfx.play().catch(() => {}); }

  // ---------- controls ----------
  $("nextBtn").addEventListener("click", next);
  $("prevBtn").addEventListener("click", prev);
  $("playBtn").addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  $("replayBtn").addEventListener("click", () => { go(state.slide, 0, true); });
  $("seek").addEventListener("input", (e) => { const d = audio.duration || C.slides[state.slide].duration; audio.currentTime = (e.target.value / 1000) * d; });
  $("muteBtn").addEventListener("click", () => {
    const m = !audio.muted; [audio, video, sfx, fx].forEach((a) => { a.muted = m; }); $("muteBtn").classList.toggle("muted", m);
  });
  $("ccBtn").addEventListener("click", () => {
    const t = $("transcript"); t.hidden = !t.hidden; $("ccBtn").setAttribute("aria-pressed", String(!t.hidden));
  });
  $("fsBtn").addEventListener("click", () => {
    const el = $("stage");
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  });
  $("menuBtn").addEventListener("click", openMenu);
  $("scrim").addEventListener("click", closeMenu);
  $("stage").addEventListener("click", (e) => { if (state.started && !C.slides[state.slide].quiz && e.target.classList.contains("layer")) next(); });
  document.addEventListener("keydown", (e) => {
    if (!state.started || e.target.closest("input, .quiz")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
    else if (e.key === " " && e.target === document.body) { e.preventDefault(); $("playBtn").click(); }
    else if (e.key === "Escape") closeMenu();
  });

  function start(from) {
    state.started = true;
    $("start").hidden = true;
    go(from, 0, true);
  }

  // ---------- boot ----------
  document.title = C.title;
  $("brandTitle").textContent = C.title;
  $("brandKicker").textContent = C.subtitle || "";
  $("startTitle").textContent = C.shortTitle || C.title;
  $("startNote").hidden = true; // no summary line under the title on the start card
  LMS.init();
  buildMenu();
  let saved = loadState();
  if (saved && saved.L !== LAYOUT) saved = null; // progress from an older layout of this lesson
  if (saved && typeof saved.s === "number") {
    state.visited = Array.isArray(saved.v) ? saved.v : [];
    state.quiz = saved.q || null;
    state.practice = saved.p && typeof saved.p === "object" ? saved.p : {};
  }
  const resume = saved && saved.s > 0 && saved.s < N ? saved.s : 0;
  if (resume) {
    $("startBtn").textContent = `Học tiếp từ trang ${resume + 1}`;
    $("restartBtn").hidden = false;
  }
  $("startBtn").addEventListener("click", () => start(resume));
  $("restartBtn").addEventListener("click", () => start(0));
  showImage(resume, 0);
  $("counter").textContent = `${resume + 1} / ${N}`;
  $("slideTitle").textContent = `${resume + 1}. ${C.slides[resume].title}`;
  $("slideText").textContent = C.slides[resume].text;
  $("progressBar").style.width = `${(state.visited.length / N) * 100}%`;
  refreshMenu();
  window.addEventListener("pagehide", LMS.finish.bind(LMS));
  window.addEventListener("beforeunload", LMS.finish.bind(LMS));
})();
