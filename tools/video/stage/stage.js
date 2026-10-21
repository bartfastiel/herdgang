// Stage control, called by the recording script (tools/video/record.ts) via page.evaluate.
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

window.stage = {
  card(id, on) {
    $(id).classList.toggle('on', on);
  },
  async chapter(kicker, heading) {
    const panel = document.querySelector('.panel');
    if ($('heading').textContent) {
      panel.classList.add('swap');
      await wait(450);
    }
    $('kicker').textContent = kicker;
    $('heading').textContent = heading;
    $('bullets').innerHTML = '';
    panel.classList.remove('swap');
  },
  bullet(html, kind) {
    const li = document.createElement('li');
    li.innerHTML = html;
    if (kind) li.className = kind;
    const list = $('bullets');
    list.appendChild(li);
    // at most four bullets, otherwise the list runs into the subtitle
    while (list.children.length > 4) list.removeChild(list.firstElementChild);
  },
  caption(text) {
    const box = $('caption');
    if (!text) return box.classList.remove('on');
    box.querySelector('span').textContent = text;
    box.classList.add('on');
  },
  tap(x, y) {
    const t = $('tap');
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    t.classList.remove('go');
    void t.offsetWidth;
    t.classList.add('go');
  },
  ring(rect) {
    const r = $('ring');
    if (!rect) return r.classList.remove('on');
    const pad = 8;
    Object.assign(r.style, { left: rect.x - pad + 'px', top: rect.y - pad + 'px', width: rect.width + 2 * pad + 'px', height: rect.height + 2 * pad + 'px' });
    r.classList.add('on');
  },
  /** show an image (e.g. a rendered PDF page) next to the phone; null hides it */
  paper(src) {
    const p = $('paper');
    document.body.classList.toggle('paper-on', !!src);
    if (!src) return p.classList.remove('on');
    return new Promise((ok) => {
      const img = $('paper-img');
      img.onload = () => {
        p.classList.add('on');
        ok();
      };
      img.src = src;
    });
  },
};
