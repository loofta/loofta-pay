import { NextResponse } from "next/server";

const HTML = String.raw`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Étude n°001 — Should we see each other again?</title>
<meta property="og:title" content="Étude scientifique très sérieuse n°001">
<meta property="og:description" content="5 questions. 2 minutes. Résultats garantis fiables.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Karla:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root{
    --paper:#FDF6F3;
    --ink:#35223B;
    --raspberry:#E4536B;
    --raspberry-soft:#F9E3E7;
    --muted:#8A7A90;
    --line:#E8D9DE;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{
    background:var(--paper);
    color:var(--ink);
    font-family:'Karla',sans-serif;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
    overflow-x:hidden;
  }
  .card{
    width:100%;
    max-width:480px;
    position:relative;
  }
  .stamp{
    font-family:'Space Mono',monospace;
    font-size:11px;
    letter-spacing:.14em;
    text-transform:uppercase;
    color:var(--muted);
    display:flex;
    justify-content:space-between;
    border-bottom:1px solid var(--line);
    padding-bottom:12px;
    margin-bottom:36px;
  }
  h1{
    font-family:'Fraunces',serif;
    font-weight:500;
    font-size:clamp(26px,6vw,34px);
    line-height:1.2;
    letter-spacing:-0.01em;
    margin-bottom:14px;
  }
  h1 em{font-style:italic;color:var(--raspberry)}
  .intro p{
    color:var(--muted);
    font-size:15.5px;
    line-height:1.55;
    margin-bottom:8px;
  }
  .mono-note{
    font-family:'Space Mono',monospace;
    font-size:11.5px;
    color:var(--muted);
    margin-top:20px;
  }
  .btn{
    appearance:none;
    border:1.5px solid var(--ink);
    background:transparent;
    color:var(--ink);
    font-family:'Karla',sans-serif;
    font-weight:600;
    font-size:15px;
    padding:13px 22px;
    border-radius:999px;
    cursor:pointer;
    transition:background .18s ease,color .18s ease,transform .12s ease;
  }
  .btn:hover{background:var(--ink);color:var(--paper)}
  .btn:active{transform:scale(.97)}
  .btn:focus-visible{outline:3px solid var(--raspberry);outline-offset:3px}
  .btn.primary{background:var(--raspberry);border-color:var(--raspberry);color:#fff}
  .btn.primary:hover{background:#d13f58;border-color:#d13f58}
  .start{margin-top:28px}

  /* quiz */
  .progress{
    display:flex;
    gap:8px;
    margin-bottom:28px;
  }
  .dot{
    width:28px;height:4px;border-radius:2px;
    background:var(--line);
    transition:background .3s ease;
  }
  .dot.on{background:var(--raspberry)}
  .qnum{
    font-family:'Space Mono',monospace;
    font-size:11px;
    letter-spacing:.14em;
    text-transform:uppercase;
    color:var(--raspberry);
    margin-bottom:10px;
  }
  .question{
    font-family:'Fraunces',serif;
    font-weight:500;
    font-size:clamp(22px,5.5vw,28px);
    line-height:1.25;
    margin-bottom:26px;
    min-height:2.5em;
  }
  .answers{
    display:flex;
    flex-direction:column;
    gap:12px;
  }
  .answers .btn{text-align:left}
  .step{
    animation:fadeUp .35s ease both;
  }
  @keyframes fadeUp{
    from{opacity:0;transform:translateY(10px)}
    to{opacity:1;transform:translateY(0)}
  }
  @media (prefers-reduced-motion:reduce){
    .step{animation:none}
    .btn{transition:none}
  }

  /* final duel */
  .duel{
    position:relative;
    display:flex;
    gap:14px;
    flex-wrap:wrap;
    min-height:120px;
    align-items:flex-start;
  }
  #noBtn{
    position:relative;
    transition:top .25s ease,left .25s ease,transform .25s ease,opacity .3s ease;
  }
  .hint{
    font-family:'Space Mono',monospace;
    font-size:11.5px;
    color:var(--muted);
    margin-top:16px;
    min-height:1.4em;
  }

  /* result */
  .verdict-label{
    font-family:'Space Mono',monospace;
    font-size:11px;
    letter-spacing:.14em;
    text-transform:uppercase;
    color:var(--muted);
    margin-bottom:12px;
  }
  .verdict{
    font-family:'Fraunces',serif;
    font-style:italic;
    font-weight:500;
    font-size:clamp(34px,9vw,52px);
    color:var(--raspberry);
    line-height:1.1;
    margin-bottom:22px;
  }
  .result-detail{
    font-size:15.5px;
    line-height:1.6;
    color:var(--ink);
    margin-bottom:6px;
  }
  .result-fine{
    font-family:'Space Mono',monospace;
    font-size:11.5px;
    color:var(--muted);
    margin-top:22px;
    line-height:1.7;
  }
  .mono-line{
    font-family:'Space Mono',monospace;
    font-size:14px;
  }
  .heart{
    position:fixed;
    top:-30px;
    font-size:18px;
    pointer-events:none;
    animation:fall linear forwards;
  }
  @keyframes fall{
    to{transform:translateY(110vh) rotate(340deg);opacity:.85}
  }
  .hidden{display:none}
</style>
</head>
<body>
<main class="card" id="app">

  <!-- INTRO -->
  <section class="step" id="intro">
    <div class="stamp"><span>Étude n°001</span><span>confidentiel</span></div>
    <h1>Should we see<br>each other <em>again?</em></h1>
    <div class="intro">
      <p>Une étude scientifique 100% impartiale*, menée par un institut indépendant d'une personne.</p>
      <p>6 questions. 2 minutes. Résultats certifiés fiables.</p>
    </div>
    <button class="btn primary start" onclick="go(1)">Commencer l'étude</button>
    <p class="mono-note">*faux</p>
  </section>

  <!-- Q1 -->
  <section class="step hidden" id="q1">
    <div class="progress"><span class="dot on"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    <div class="qnum">Question 01 / 06 — vérification d'identité</div>
    <div class="question">Tu es bien Astrid?</div>
    <div class="answers">
      <button class="btn" onclick="go(2)">oui</button>
      <button class="btn" onclick="go(2)">aux dernières nouvelles</button>
      <button class="btn" onclick="go(2)">qui d'autre recevrait ce lien</button>
    </div>
  </section>

  <!-- Q2 -->
  <section class="step hidden" id="q2">
    <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    <div class="qnum">Question 02 / 06 — information capitale</div>
    <div class="question">Nacho a une nouvelle coupe. Tu veux voir?</div>
    <div class="answers" id="nachoAnswers">
      <button class="btn" onclick="revealNacho()">oui</button>
      <button class="btn" onclick="revealNacho()">évidemment</button>
      <button class="btn" onclick="revealNacho()">c'est la seule raison de ma venue</button>
    </div>
    <div id="nachoReveal" class="hidden" style="margin-top:8px">
      <img src="https://i.ibb.co/whD1PQS4/IMG-1284.jpg" alt="Nacho et sa nouvelle coupe" id="nachoImg"
           style="width:100%;border-radius:16px;border:1.5px solid var(--line);display:block"
           onerror="this.outerHTML='&lt;div style=&quot;font-size:64px;text-align:center;padding:30px 0&quot;&gt;🐕&lt;/div&gt;'">
      <p class="hint" style="margin-top:10px">la coupe.</p>
      <button class="btn primary" style="margin-top:14px" onclick="go(3)">Continuer l'étude</button>
    </div>
  </section>

  <!-- Q3 -->
  <section class="step hidden" id="q3">
    <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    <div class="qnum">Question 03 / 06</div>
    <div class="question">Hypothèse purement théorique: on se revoit. Ce serait plutôt:</div>
    <div class="answers">
      <button class="btn" onclick="go(4)">un açaï</button>
      <button class="btn" onclick="go(4)">une balade</button>
      <button class="btn" onclick="go(4)">les deux, dans le désordre</button>
    </div>
  </section>

  <!-- Q4 -->
  <section class="step hidden" id="q4">
    <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot"></span><span class="dot"></span></div>
    <div class="qnum">Question 04 / 06</div>
    <div class="question">Sois honnête: tu as souri depuis la photo de Nacho?</div>
    <div class="answers">
      <button class="btn" onclick="go(5)">oui</button>
      <button class="btn" onclick="go(5)">un peu</button>
      <button class="btn" onclick="go(5)">non — <em>mensonge détecté par nos capteurs</em></button>
    </div>
  </section>

  <!-- Q5 : Nacho -->
  <section class="step hidden" id="q5">
    <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot"></span></div>
    <div class="qnum">Question 05 / 06</div>
    <div class="question">L'institut a adoré les moments passés avec toi. Réaction:</div>
    <div class="answers">
      <button class="btn" onclick="go(6)">pareil</button>
      <button class="btn" onclick="go(6)">c'est réciproque</button>
      <button class="btn" onclick="go(6)">objection retenue nulle part</button>
    </div>
  </section>

  <!-- Q6 : the duel -->
  <section class="step hidden" id="q6">
    <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span></div>
    <div class="qnum">Question 06 / 06 — question de contrôle</div>
    <div class="question">Donc. On devrait se revoir?</div>
    <div class="duel" id="duelZone">
      <button class="btn primary" onclick="showResult()">Oui</button>
      <button class="btn" id="noBtn">Non</button>
    </div>
    <p class="hint" id="hint"></p>
  </section>

  <!-- FAKE ANALYSIS -->
  <section class="step hidden" id="analysis">
    <div class="stamp"><span>Étude n°001</span><span>traitement</span></div>
    <div class="verdict-label">Analyse en cours</div>
    <p class="result-detail mono-line" id="analysisLine">analyse des réponses…</p>
  </section>

  <!-- RESULT -->
  <section class="step hidden" id="result">
    <div class="stamp"><span>Étude n°001</span><span>résultats définitifs</span></div>
    <div class="verdict-label">Verdict de l'étude</div>
    <div class="verdict">Go for it.</div>
    <p class="result-detail">100% des réponses convergent vers la même conclusion: on devrait se revoir.</p>
    <p class="result-detail">Le comité scientifique recommande un açaï. Le comité, c'est moi.</p>
    <button class="btn primary" id="replyBtn" style="margin-top:18px">Répondre à l'institut</button>
    <button class="btn" id="contestBtn" style="margin-top:10px">Contester le résultat</button>
    <p class="hint" id="contestHint"></p>
    <p class="result-fine">marge d'erreur: 0%<br>biais de l'étude: assumé<br>protocole: validé par personne, regretté par personne<br>cette étude a été codée un dimanche soir. tirez-en les conclusions que vous voulez.</p>
  </section>

</main>

<script>
  let current = 'intro';
  function show(id){
    document.getElementById(current).classList.add('hidden');
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    current = id;
  }
  function go(n){ show('q' + n); }

  function revealNacho(){
    document.getElementById('nachoAnswers').classList.add('hidden');
    document.getElementById('nachoReveal').classList.remove('hidden');
  }

  // The fleeing "Non" button
  const noBtn = document.getElementById('noBtn');
  const hint = document.getElementById('hint');
  let dodges = 0;
  const hints = [
    '',
    'intéressant.',
    'le bouton semble en désaccord.',
    'il fuit. c’est un signe.',
    'bon.'
  ];

  function dodge(e){
    if (dodges >= 4){ return; }
    if (e && e.cancelable) e.preventDefault();
    dodges++;
    const zone = document.getElementById('duelZone');
    const zr = zone.getBoundingClientRect();
    const maxX = Math.max(20, Math.min(zr.width - noBtn.offsetWidth - 4, 260));
    const x = Math.random() * maxX;
    const y = 40 + Math.random() * 70;
    noBtn.style.position = 'absolute';
    noBtn.style.left = x + 'px';
    noBtn.style.top = y + 'px';
    noBtn.style.transform = 'scale(' + Math.max(0.6, 1 - dodges * 0.1) + ')';
    hint.textContent = hints[Math.min(dodges, hints.length - 1)];
    if (dodges >= 4){
      noBtn.textContent = 'ok, oui alors';
      noBtn.classList.add('primary');
      noBtn.style.transform = 'scale(1)';
      noBtn.onclick = showResult;
      noBtn.onmouseenter = null;
      noBtn.ontouchstart = null;
      noBtn.onpointerdown = null;
      hint.textContent = 'l’institut présente ses excuses au bouton non.';
    }
  }
  noBtn.onmouseenter = dodge;
  noBtn.onpointerdown = function(e){ if(e.pointerType !== 'mouse') dodge(e); };
  noBtn.onclick = function(e){ if (dodges < 4) { dodge(e); } };

  // gentle heart rain on result
  function showResult(){
    show('analysis');
    const line = document.getElementById('analysisLine');
    const seq = [
      'analyse des réponses…',
      'vérification du biais…',
      'biais confirmé.',
      'publication des résultats.'
    ];
    let i = 0;
    const tick = setInterval(function(){
      i++;
      if (i < seq.length){ line.textContent = seq[i]; }
      else {
        clearInterval(tick);
        revealResult();
      }
    }, 850);
  }

  function revealResult(){
    show('result');
    const glyphs = ['♥','♡'];
    for (let i = 0; i < 26; i++){
      setTimeout(function(){
        const h = document.createElement('span');
        h.className = 'heart';
        h.textContent = glyphs[Math.floor(Math.random()*glyphs.length)];
        h.style.left = Math.random()*100 + 'vw';
        h.style.color = Math.random() > .5 ? '#E4536B' : '#35223B';
        h.style.fontSize = (12 + Math.random()*14) + 'px';
        h.style.animationDuration = (3 + Math.random()*3) + 's';
        document.body.appendChild(h);
        setTimeout(function(){ h.remove(); }, 6500);
      }, i * 130);
    }
  }

  // reply to the institute — opens iMessage with a pre-filled message
  document.getElementById('replyBtn').onclick = function(){
    const message = "hey I just saw the study, let's go for it but it's your last chance.";
    const ch = document.getElementById('contestHint');
    ch.textContent = 'ouverture de iMessage…';
    window.location.href = 'sms:+33767369584&body=' + encodeURIComponent(message);
  };

  // contest the result
  let contests = 0;
  document.getElementById('contestBtn').onclick = function(){
    contests++;
    const ch = document.getElementById('contestHint');
    if (contests === 1){
      ch.textContent = 'réclamation reçue. réclamation rejetée. (délai de traitement: 0.2s)';
    } else if (contests === 2){
      ch.textContent = 'n’insiste pas.';
    } else {
      ch.textContent = 'le bureau des réclamations est parti prendre un açaï.';
      this.disabled = true;
      this.style.opacity = .45;
      this.style.cursor = 'default';
    }
  };
</script>
</body>
</html>
`;

export async function GET() {
  return new NextResponse(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "no-store",
    },
  });
}
