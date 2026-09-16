const HISTORY_KEY = 'telegramShopNavigation';
const catalogRoute = () => ({ page: 'catalog', selectedProduct: null, initialAdminSection: 'details', catalogState: null, cartOpen: false, depth: 0 });

// Keep our state namespaced so browser/host history metadata is preserved.
export function createShopNavigation(host) {
  const saved = host.history.state?.[HISTORY_KEY];
  let owner = saved?.owner || `${Date.now()}-${Math.random()}`;
  let state = saved?.route || catalogRoute();
  let backPending = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener(state));
  const write = (route, push = false) => {
    state = route;
    host.history[push ? 'pushState' : 'replaceState']({
      ...host.history.state,
      [HISTORY_KEY]: { owner, route },
    }, '');
    emit();
  };
  const pop = (event) => {
    backPending = false;
    const entry = event.state?.[HISTORY_KEY];
    if (entry?.owner === owner) {
      state = entry.route;
      emit();
    } else {
      // Entries from a logged-out session must not restore its UI state.
      write(catalogRoute());
    }
  };
  const navigate = (changes) => write({ ...state, ...changes, depth: state.depth + 1 }, true);
  const back = () => {
    if (backPending) return;
    if (state.depth > 0) {
      backPending = true;
      host.history.back();
    } else write({ ...catalogRoute(), catalogState: state.catalogState });
  };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() {
      write(state);
      host.addEventListener('popstate', pop);
      return () => host.removeEventListener('popstate', pop);
    },
    openProduct: (product) => navigate({ page: 'product', selectedProduct: product, cartOpen: false }),
    openAdmin: (section = 'details') => navigate({ page: 'admin', initialAdminSection: section, selectedProduct: null, cartOpen: false }),
    openCart: () => { if (!state.cartOpen) navigate({ cartOpen: true }); },
    closeCart: () => { if (state.cartOpen) back(); },
    saveCatalogState: (catalogState) => write({ ...state, catalogState }),
    back,
    reset() {
      owner = `${Date.now()}-${Math.random()}`;
      backPending = false;
      write(catalogRoute());
    },
  };
}
