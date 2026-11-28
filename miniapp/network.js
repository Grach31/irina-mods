/* Keep request deadlines active through response-body reads, including on iOS. */
function msDeadline(run, milliseconds = 12000, parent) {
 const controller = new AbortController();
 const abort = () => controller.abort();
 if(parent?.aborted) abort();
 else parent?.addEventListener('abort', abort, {once:true});
 let timer, onAbort;
 const stopped = new Promise((_, reject) => {
  onAbort = () => reject(new DOMException('Запрос прерван', 'AbortError'));
  if(controller.signal.aborted) onAbort();
  else controller.signal.addEventListener('abort', onAbort, {once:true});
  timer = setTimeout(() => {
   reject(new DOMException('Истекло время ожидания', 'TimeoutError'));
   abort();
  }, milliseconds);
 });
 const task = Promise.resolve().then(() => {
  if(controller.signal.aborted) throw new DOMException('Запрос прерван', 'AbortError');
  return run(controller.signal);
 });
 return Promise.race([task, stopped]).finally(() => {
  clearTimeout(timer);
  controller.signal.removeEventListener('abort', onAbort);
  parent?.removeEventListener('abort', abort);
  abort();
 });
}

function msRequestJSON(url, options = {}, milliseconds = 12000) {
 return msDeadline(async signal => {
  const response = await fetch(url, {...options, signal});
  return {response, data: response.ok ? await response.json() : await response.json().catch(() => ({}))};
 }, milliseconds, options.signal);
}

function msLoadScript(src, milliseconds) {
 const script = document.createElement('script');
 script.src = src;
 return msDeadline(() => new Promise((resolve, reject) => {
  script.onload = resolve;
  script.onerror = () => reject(Error('Не удалось загрузить ' + src));
  document.head.append(script);
 }), milliseconds).finally(() => script.remove());
}
