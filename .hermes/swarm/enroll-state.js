export function getEnrollState() {
  return JSON.stringify({
    url: location.pathname,
    h1: document.querySelector('h1')?.textContent,
    err: (document.body.innerText.match(/Unable[^"\\]{0,60}/) || [null])[0],
    btns: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 6),
  });
}
getEnrollState();
