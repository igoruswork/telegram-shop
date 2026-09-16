export function sortProducts(products) {
  return [...products].sort((left, right) => (
    Number(right.number_sites ?? 0) - Number(left.number_sites ?? 0) || Number(left.id) - Number(right.id)
  ));
}

// Fold each burst in arrival order. A deletion must win over earlier updates,
// while a later insertion may legitimately bring the same id back.
export function applyProductChanges(products, events) {
  if (!events.length) return products;
  const byId = new Map(products.map((product) => [String(product.id), product]));
  let changed = false;
  let orderChanged = false;
  for (const event of events) {
    const id = event?.new?.id ?? event?.old?.id;
    if (id == null || !['INSERT', 'UPDATE', 'DELETE'].includes(event.eventType)) continue;
    const key = String(id);
    const previous = byId.get(key);
    if (event.eventType === 'DELETE') {
      changed = byId.delete(key) || changed;
      continue;
    }
    const next = { ...previous, ...event.new };
    if (!next.view) {
      changed = byId.delete(key) || changed;
      continue;
    }
    if (previous && Object.keys(next).every((field) => Object.is(previous[field], next[field]))) continue;
    changed = true;
    if (!previous || Number(previous.number_sites ?? 0) !== Number(next.number_sites ?? 0)) orderChanged = true;
    byId.set(key, next);
  }
  if (!changed) return products;
  const next = [...byId.values()];
  return orderChanged ? sortProducts(next) : next;
}

export function createProductEventBuffer(onFlush, delay = 100) {
  let events = [];
  let timer;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!events.length) return;
    const batch = events;
    events = [];
    onFlush(batch);
  };
  return {
    push(event) {
      events.push(event);
      if (timer === undefined) timer = setTimeout(flush, delay);
    },
    flush,
    cancel() { clearTimeout(timer); timer = undefined; events = []; },
  };
}

// Trailing writes, with a maximum wait so continuous price imports still
// checkpoint the cache. flush() is also used on pagehide/backgrounding.
export function createCatalogCacheWriter(write, delay = 500, maxWait = 2000) {
  let pending;
  let timer;
  let deadline;
  const flush = () => {
    clearTimeout(timer);
    clearTimeout(deadline);
    timer = deadline = undefined;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    write(value);
  };
  return {
    schedule(value) {
      pending = value;
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
      if (deadline === undefined) deadline = setTimeout(flush, maxWait);
    },
    flush,
  };
}
