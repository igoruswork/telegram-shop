import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTelegram } from './lib/useTelegram';
import {
  fetchAppSettings,
  fetchCatalogUserAccess,
  fetchProducts,
  logAccess,
  saveAppSettings,
  subscribeToAppSettings,
  subscribeToProducts,
  supabaseConfigError,
} from './lib/supabase';
import { GatePage } from './pages/GatePage';
import { CatalogPage } from './pages/CatalogPage';
import { isPhoneComplete, normalizePhoneInput } from './lib/phone';
import { isComingSoon } from './lib/productDisplay';
import './styles.css';

const ProductPage = React.lazy(() => import('./pages/ProductPage').then((module) => ({ default: module.ProductPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const CartDrawer = React.lazy(() => import('./components/CartDrawer').then((module) => ({ default: module.CartDrawer })));

const ADMIN_PHONE = '+380111111111';
const DEFAULT_ADMIN_PHONES = [ADMIN_PHONE];
const DEFAULT_CATALOG_TITLE = 'Каталог';
const DEFAULT_BRAND_COLOR = '#075985';
const DEFAULT_PAYMENT_CARD_COLOR = '#B8A477';
const DEFAULT_PAYMENT_TAX_ID = '3830010811';
const DEFAULT_PAYMENT_CARD_VISIBILITY = {
  enabled: true,
  name: true,
  iban: true,
  taxId: true,
  extraDetails: true,
};
const DEFAULT_ADMIN_SECTION_ORDER = [
  'title', 'create', 'colors', 'details', 'pricing', 'visibility',
  'access', 'access-log', 'orders', 'section-order',
];
const BRAND_COLORS_STORAGE_KEY = 'telegram-shop-brand-colors';
const CATALOG_TITLE_STORAGE_KEY = 'telegram-shop-catalog-title';
const CATALOG_CACHE_STORAGE_KEY = 'telegram-shop-catalog-cache:v1';
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const USER_STORAGE_KEY = 'telegram-shop-user';
const CART_STORAGE_PREFIX = 'telegram-shop-cart:';

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '');
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ].join(', ');
}

function darkenHex(hex, amount = 0.34) {
  const value = hex.replace('#', '');
  const channels = [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];

  const darkened = channels
    .map((channel) => Math.max(0, Math.round(channel * (1 - amount))))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');

  return `#${darkened}`;
}

function loadStoredBrandColors() {
  try {
    const raw = localStorage.getItem(BRAND_COLORS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return normalizeBrandColors(parsed);
  } catch {
    return {};
  }
}

function normalizeAdminPhones(value) {
  const source = Array.isArray(value) ? value : [];
  const phones = source
    .map((phone) => normalizePhoneInput(phone))
    .filter(isPhoneComplete);

  const uniquePhones = [...new Set(phones)];
  return uniquePhones.length ? uniquePhones : DEFAULT_ADMIN_PHONES;
}

function loadStoredUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const phone = normalizePhoneInput(parsed?.phone);
    const lastName = String(parsed?.lastName || parsed?.last_name || '').trim();

    if (!isPhoneComplete(phone) || !lastName) return null;

    return {
      phone,
      lastName,
    };
  } catch {
    return null;
  }
}

function cartStorageKey(phone) {
  const normalizedPhone = normalizePhoneInput(phone);
  return isPhoneComplete(normalizedPhone) ? `${CART_STORAGE_PREFIX}${normalizedPhone}` : '';
}

function loadStoredCart(storageKey) {
  if (!storageKey) return [];

  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && item.id && item.name && Number(item.price) >= 0 && Number(item.qty) > 0)
      .map((item) => ({
        id: item.id,
        name: String(item.name),
        price: Number(item.price),
        sku: String(item.sku || ''),
        thumbnail_url: String(item.thumbnail_url || ''),
        qty: Math.max(1, Math.floor(Number(item.qty))),
      }));
  } catch {
    return [];
  }
}

function loadStoredCatalogCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CATALOG_CACHE_STORAGE_KEY) || 'null');
    const cachedAt = Number(cached?.cachedAt || 0);
    const products = Array.isArray(cached?.products) ? cached.products : [];

    if (!cachedAt || Date.now() - cachedAt > CATALOG_CACHE_TTL_MS || products.length === 0) {
      return null;
    }

    return sortProducts(products.filter((product) => product && product.id && product.name));
  } catch {
    return null;
  }
}

function saveCatalogCache(products) {
  try {
    localStorage.setItem(CATALOG_CACHE_STORAGE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      products,
    }));
  } catch {
    // The catalog stays functional if browser storage is unavailable or full.
  }
}

function normalizeBrandColors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([brand, color]) => String(brand).trim() && isHexColor(color))
  );
}

function normalizePaymentCardVisibility(value) {
  const source = value && typeof value === 'object' ? value : {};

  return Object.fromEntries(
    Object.entries(DEFAULT_PAYMENT_CARD_VISIBILITY).map(([key, defaultValue]) => [
      key,
      typeof source[key] === 'boolean' ? source[key] : defaultValue,
    ])
  );
}

function normalizeAdminSectionOrder(value) {
  const requestedIds = Array.isArray(value) ? value : [];
  const knownIds = new Set(DEFAULT_ADMIN_SECTION_ORDER);
  const uniqueIds = [...new Set(requestedIds.filter((id) => knownIds.has(id)))];

  return [...uniqueIds, ...DEFAULT_ADMIN_SECTION_ORDER.filter((id) => !uniqueIds.includes(id))];
}

function normalizeAppSettings(value) {
  const brandColors = normalizeBrandColors(value?.brandColors || value?.brand_colors || {});
  const adminPhones = normalizeAdminPhones(value?.adminPhones || value?.admin_phones || []);
  const rawTitle = value?.catalogTitle || value?.catalog_title || '';
  const catalogTitle = typeof rawTitle === 'string' && rawTitle.trim()
    ? rawTitle.trim()
    : DEFAULT_CATALOG_TITLE;
  const paymentDetails = String(value?.paymentDetails || value?.payment_details || '')
    .trim()
    .slice(0, 180);
  const paymentIban = String(value?.paymentIban || value?.payment_iban || '')
    .toLocaleUpperCase('uk-UA')
    .replace(/\s+/g, '')
    .slice(0, 34);
  const paymentCardColor = isHexColor(value?.paymentCardColor || value?.payment_card_color)
    ? (value.paymentCardColor || value.payment_card_color).toUpperCase()
    : DEFAULT_PAYMENT_CARD_COLOR;
  const paymentTaxId = String(value?.paymentTaxId || value?.payment_tax_id || DEFAULT_PAYMENT_TAX_ID)
    .replace(/\s+/g, '')
    .slice(0, 16);
  const paymentExtraDetails = String(value?.paymentExtraDetails || value?.payment_extra_details || '')
    .trim()
    .slice(0, 280);
  const paymentCardVisibility = normalizePaymentCardVisibility(
    value?.paymentCardVisibility || value?.payment_card_visibility
  );
  const adminSectionOrder = normalizeAdminSectionOrder(
    value?.adminSectionOrder || value?.admin_section_order
  );

  return {
    brandColors,
    catalogTitle,
    adminPhones,
    paymentDetails,
    paymentIban,
    paymentCardColor,
    paymentTaxId,
    paymentExtraDetails,
    paymentCardVisibility,
    adminSectionOrder,
  };
}

function sortProducts(products) {
  return [...products].sort((left, right) => {
    const leftOrder = Number(left.number_sites ?? 0);
    const rightOrder = Number(right.number_sites ?? 0);
    return leftOrder - rightOrder;
  });
}

export default function App() {
  const { user, haptic, hapticNotification } = useTelegram();
  const storedUser = useMemo(loadStoredUser, []);
  const [initialCatalogCache] = useState(loadStoredCatalogCache);
  const [catalogTitle, setCatalogTitle] = useState(() => {
    const stored = localStorage.getItem(CATALOG_TITLE_STORAGE_KEY)?.trim();
    return stored || DEFAULT_CATALOG_TITLE;
  });
  const [brandColors, setBrandColors] = useState(loadStoredBrandColors);
  const [adminPhones, setAdminPhones] = useState(DEFAULT_ADMIN_PHONES);
  const [paymentDetails, setPaymentDetails] = useState('');
  const [paymentIban, setPaymentIban] = useState('');
  const [paymentCardColor, setPaymentCardColor] = useState(DEFAULT_PAYMENT_CARD_COLOR);
  const [paymentTaxId, setPaymentTaxId] = useState(DEFAULT_PAYMENT_TAX_ID);
  const [paymentExtraDetails, setPaymentExtraDetails] = useState('');
  const [paymentCardVisibility, setPaymentCardVisibility] = useState(DEFAULT_PAYMENT_CARD_VISIBILITY);
  const [adminSectionOrder, setAdminSectionOrder] = useState(DEFAULT_ADMIN_SECTION_ORDER);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [remoteSettingsFound, setRemoteSettingsFound] = useState(false);
  const defaultBrandColor = brandColors.__default || DEFAULT_BRAND_COLOR;
  const saveSettingsTimeoutRef = useRef(null);
  const localSettingsMigrationRef = useRef(false);
  const storedAccessLoggedRef = useRef(false);
  const settingsSnapshotRef = useRef({});

  // ─── Авторизація (гейт) ──────────────────────────────
  const [authorized, setAuthorized] = useState(false);
  const [accessChecked, setAccessChecked] = useState(!storedUser);
  const [gateData, setGateData] = useState(storedUser || { phone: '', lastName: '' });
  const isAdmin = adminPhones.includes(normalizePhoneInput(gateData.phone));

  // ─── Навігація ────────────────────────────────────────
  const [page, setPage] = useState('catalog'); // 'catalog' | 'product' | 'admin'
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [initialAdminSection, setInitialAdminSection] = useState('details');

  // ─── Збереження стану каталогу (скрол + категорія) ───
  const [catalogState, setCatalogState] = useState(null);

  // ─── Дані з Supabase ─────────────────────────────────
  const [products, setProducts] = useState(() => initialCatalogCache || []);
  const [loading, setLoading] = useState(() => !initialCatalogCache);
  const [loadError, setLoadError] = useState(supabaseConfigError);

  // ─── Кошик (зберігається на пристрої до оформлення або очищення) ──
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartStorageReadyKey, setCartStorageReadyKey] = useState('');
  const activeCartStorageKey = useMemo(
    () => (authorized ? cartStorageKey(gateData.phone) : ''),
    [authorized, gateData.phone]
  );

  const categories = useMemo(() => (
    [...new Set(products.map((product) => product.category).filter(Boolean))].sort()
  ), [products]);

  const cartQtyByProductId = useMemo(
    () => new Map(cart.map((item) => [item.id, item.qty])),
    [cart]
  );

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.price) * item.qty, 0),
    [cart]
  );

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty, 0),
    [cart]
  );

  useEffect(() => {
    if (!activeCartStorageKey) {
      setCart([]);
      setCartStorageReadyKey('');
      return;
    }

    setCart(loadStoredCart(activeCartStorageKey));
    setCartStorageReadyKey(activeCartStorageKey);
  }, [activeCartStorageKey]);

  useEffect(() => {
    if (!activeCartStorageKey || cartStorageReadyKey !== activeCartStorageKey) return;

    try {
      if (cart.length) {
        localStorage.setItem(activeCartStorageKey, JSON.stringify(cart));
      } else {
        localStorage.removeItem(activeCartStorageKey);
      }
    } catch {
      // The basket still works during this visit when browser storage is unavailable.
    }
  }, [activeCartStorageKey, cart, cartStorageReadyKey]);

  useEffect(() => {
    let frame = 0;

    const setViewportHeight = () => {
      frame = 0;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
    };

    const scheduleViewportHeight = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(setViewportHeight);
    };

    setViewportHeight();
    window.addEventListener('resize', scheduleViewportHeight);
    window.visualViewport?.addEventListener('resize', scheduleViewportHeight);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleViewportHeight);
      window.visualViewport?.removeEventListener('resize', scheduleViewportHeight);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--brand-color', defaultBrandColor);
    document.documentElement.style.setProperty('--brand-price-color', darkenHex(defaultBrandColor));
    document.documentElement.style.setProperty('--brand-rgb', hexToRgb(defaultBrandColor));
    localStorage.setItem(BRAND_COLORS_STORAGE_KEY, JSON.stringify(brandColors));
  }, [brandColors, defaultBrandColor]);

  useEffect(() => {
    localStorage.setItem(CATALOG_TITLE_STORAGE_KEY, catalogTitle.trim() || DEFAULT_CATALOG_TITLE);
  }, [catalogTitle]);

  useEffect(() => {
    if (!storedUser) return undefined;

    let cancelled = false;
    let retryTimer = null;
    let attempts = 0;

    const checkStoredAccess = async () => {
      try {
        const catalogUser = await fetchCatalogUserAccess(storedUser.phone);
        if (cancelled) return;
        if (catalogUser?.is_approved && !catalogUser.is_blocked) {
          const currentUser = {
            phone: catalogUser.phone,
            lastName: String(catalogUser.last_name || storedUser.lastName || '').trim(),
          };
          // Keep the local identity in sync with administrator edits.
          setGateData(currentUser);
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
          setAuthorized(true);
          setAccessChecked(true);
          if (!storedAccessLoggedRef.current) {
            storedAccessLoggedRef.current = true;
            logAccess({
              phone: currentUser.phone,
              lastName: currentUser.lastName,
              tgUserId: user?.id,
            }).catch((error) => console.warn('stored user access log error:', error));
          }
          return;
        }
        // Keep only a local identity hint for the next launch. It does not
        // grant access: the user still sees the gate until an administrator
        // changes is_approved in Supabase.
        setGateData({ phone: '', lastName: '' });
        setAccessChecked(true);
      } catch (error) {
        console.warn('stored user access check error:', error);
        if (cancelled) return;

        // A network hiccup must not immediately throw a previously approved
        // visitor back to the gate. Retries still require a successful server
        // response before restoring the session.
        if (attempts < 2) {
          const delay = 500 * (2 ** attempts);
          attempts += 1;
          retryTimer = window.setTimeout(checkStoredAccess, delay);
          return;
        }

        setAccessChecked(true);
      }
    };

    checkStoredAccess();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [storedUser, user?.id]);

  const applyRemoteSettings = useCallback((settings) => {
    if (!settings || typeof settings !== 'object') return false;

    const normalized = normalizeAppSettings(settings);
    setBrandColors(normalized.brandColors);
    setCatalogTitle(normalized.catalogTitle);
    setAdminPhones(normalized.adminPhones);
    setPaymentDetails(normalized.paymentDetails);
    setPaymentIban(normalized.paymentIban);
    setPaymentCardColor(normalized.paymentCardColor);
    setPaymentTaxId(normalized.paymentTaxId);
    setPaymentExtraDetails(normalized.paymentExtraDetails);
    setPaymentCardVisibility(normalized.paymentCardVisibility);
    setAdminSectionOrder(normalized.adminSectionOrder);
    return true;
  }, []);

  useEffect(() => {
    settingsSnapshotRef.current = {
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
      adminSectionOrder,
    };
  }, [adminPhones, adminSectionOrder, brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, paymentTaxId]);

  const queueSaveSettings = useCallback((settings) => {
    const normalized = normalizeAppSettings({ ...settingsSnapshotRef.current, ...settings });

    if (saveSettingsTimeoutRef.current) {
      window.clearTimeout(saveSettingsTimeoutRef.current);
    }

    saveSettingsTimeoutRef.current = window.setTimeout(async () => {
      try {
        await saveAppSettings(normalized);
        setRemoteSettingsFound(true);
      } catch (error) {
        console.warn('saveAppSettings error:', error);
      }
    }, 350);
  }, []);

  useEffect(() => () => {
    if (saveSettingsTimeoutRef.current) {
      window.clearTimeout(saveSettingsTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchAppSettings()
      .then((settings) => {
        if (cancelled) return;
        if (applyRemoteSettings(settings)) {
          setRemoteSettingsFound(true);
        }
      })
      .catch((error) => {
        console.warn('fetchAppSettings error:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyRemoteSettings]);

  useEffect(() => {
    if (!settingsLoaded) return undefined;

    return subscribeToAppSettings((settings) => {
      if (applyRemoteSettings(settings)) {
        setRemoteSettingsFound(true);
      }
    });
  }, [applyRemoteSettings, settingsLoaded]);

  const setBrandColorForBrand = useCallback((brand, color) => {
    const key = String(brand || '').trim();
    if (!key || !isHexColor(color)) return;

    const nextBrandColors = {
      ...brandColors,
      [key]: color,
    };

    setBrandColors(nextBrandColors);
    queueSaveSettings({
      brandColors: nextBrandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, paymentTaxId, queueSaveSettings]);

  const setCatalogTitleSetting = useCallback((value) => {
    const nextCatalogTitle = String(value || '').trim() || DEFAULT_CATALOG_TITLE;

    setCatalogTitle(nextCatalogTitle);
    queueSaveSettings({
      brandColors,
      catalogTitle: nextCatalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, brandColors, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, paymentTaxId, queueSaveSettings]);

  const setAdminPhonesSetting = useCallback((phones) => {
    const nextAdminPhones = normalizeAdminPhones(phones);

    setAdminPhones(nextAdminPhones);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones: nextAdminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, paymentTaxId, queueSaveSettings]);

  const setPaymentDetailsSetting = useCallback((value) => {
    const nextPaymentDetails = String(value || '').slice(0, 180);

    setPaymentDetails(nextPaymentDetails);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails: nextPaymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentExtraDetails, paymentIban, paymentTaxId, queueSaveSettings]);

  const setPaymentIbanSetting = useCallback((value) => {
    const nextPaymentIban = String(value || '')
      .toLocaleUpperCase('uk-UA')
      .replace(/\s+/g, '')
      .slice(0, 34);

    setPaymentIban(nextPaymentIban);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban: nextPaymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentTaxId, queueSaveSettings]);

  const setPaymentCardColorSetting = useCallback((value) => {
    if (!isHexColor(value)) return;

    const nextPaymentCardColor = value.toUpperCase();
    setPaymentCardColor(nextPaymentCardColor);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor: nextPaymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, brandColors, catalogTitle, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, paymentTaxId, queueSaveSettings]);

  const setPaymentTaxIdSetting = useCallback((value) => {
    const nextPaymentTaxId = String(value || '').replace(/\s+/g, '').slice(0, 16);

    setPaymentTaxId(nextPaymentTaxId);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId: nextPaymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, queueSaveSettings]);

  const setPaymentExtraDetailsSetting = useCallback((value) => {
    const nextPaymentExtraDetails = String(value || '').slice(0, 280);

    setPaymentExtraDetails(nextPaymentExtraDetails);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails: nextPaymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentDetails, paymentIban, paymentTaxId, queueSaveSettings]);

  const setPaymentCardVisibilitySetting = useCallback((key, visible) => {
    if (!(key in DEFAULT_PAYMENT_CARD_VISIBILITY)) return;

    const nextPaymentCardVisibility = {
      ...paymentCardVisibility,
      [key]: Boolean(visible),
    };

    setPaymentCardVisibility(nextPaymentCardVisibility);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility: nextPaymentCardVisibility,
    });
  }, [adminPhones, brandColors, catalogTitle, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, paymentTaxId, queueSaveSettings]);

  const setAdminSectionOrderSetting = useCallback((value) => {
    const nextOrder = normalizeAdminSectionOrder(value);
    setAdminSectionOrder(nextOrder);
    queueSaveSettings({ adminSectionOrder: nextOrder });
  }, [queueSaveSettings]);

  useEffect(() => {
    if (
      !authorized ||
      !isAdmin ||
      !settingsLoaded ||
      remoteSettingsFound ||
      localSettingsMigrationRef.current
    ) {
      return;
    }

    const hasLocalSettings =
      Object.keys(brandColors).length > 0 ||
      (catalogTitle.trim() && catalogTitle.trim() !== DEFAULT_CATALOG_TITLE);

    if (!hasLocalSettings) return;

    localSettingsMigrationRef.current = true;
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones,
      paymentDetails,
      paymentIban,
      paymentCardColor,
      paymentTaxId,
      paymentExtraDetails,
      paymentCardVisibility,
    });
  }, [adminPhones, authorized, brandColors, catalogTitle, isAdmin, paymentCardColor, paymentCardVisibility, paymentDetails, paymentExtraDetails, paymentIban, paymentTaxId, queueSaveSettings, remoteSettingsFound, settingsLoaded]);

  // ─── Завантаження даних з Supabase ───────────────────
  const loadData = useCallback(async ({ keepCachedCatalog = false } = {}) => {
    if (!keepCachedCatalog) setLoading(true);
    setLoadError('');

    try {
      const productsData = await fetchProducts();
      const sortedProducts = sortProducts(productsData);
      setProducts(sortedProducts);
      saveCatalogCache(sortedProducts);
    } catch (error) {
      if (!keepCachedCatalog) {
        setProducts([]);
        setLoadError(error.message || 'Не вдалося завантажити дані.');
      } else {
        console.warn('catalog background refresh error:', error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const applyProductRealtimeChange = useCallback((payload) => {
    const eventType = payload?.eventType;
    const changedProduct = payload?.new;
    const changedId = changedProduct?.id || payload?.old?.id;
    if (!changedId) return;

    setProducts((currentProducts) => {
      if (eventType === 'DELETE') {
        const nextProducts = currentProducts.filter((product) => product.id !== changedId);
        saveCatalogCache(nextProducts);
        return nextProducts;
      }

      const existingIndex = currentProducts.findIndex((product) => product.id === changedId);
      const nextProduct = existingIndex === -1
        ? changedProduct
        : { ...currentProducts[existingIndex], ...changedProduct };

      if (!nextProduct?.view) {
        const nextProducts = currentProducts.filter((product) => product.id !== changedId);
        saveCatalogCache(nextProducts);
        return nextProducts;
      }

      if (existingIndex === -1) {
        const sortedProducts = sortProducts([...currentProducts, nextProduct]);
        saveCatalogCache(sortedProducts);
        return sortedProducts;
      }

      const nextProducts = [...currentProducts];
      nextProducts[existingIndex] = nextProduct;
      const sortedProducts = sortProducts(nextProducts);
      saveCatalogCache(sortedProducts);
      return sortedProducts;
    });
  }, []);

  // ─── Після авторизації: завантажити + підписатися на Realtime
  useEffect(() => {
    if (!authorized) return;

    const cachedCatalog = loadStoredCatalogCache();
    if (cachedCatalog) {
      setProducts(cachedCatalog);
      setLoading(false);
    }

    loadData({ keepCachedCatalog: Boolean(cachedCatalog) });

    const unsubscribe = subscribeToProducts(applyProductRealtimeChange);

    return unsubscribe;
  }, [applyProductRealtimeChange, authorized, loadData]);

  // Keep persisted carts aligned with current product availability and prices.
  useEffect(() => {
    if (!products.length) return;
    const byId = new Map(products.map((product) => [product.id, product]));
    setCart((current) => current.filter((item) => !isComingSoon(byId.get(item.id))).map((item) => {
      const product = byId.get(item.id);
      return product ? { ...item, price: product.price, name: product.name } : item;
    }));
  }, [products, cartStorageReadyKey]);

  // ─── Кошик ───────────────────────────────────────────
  const addToCart = useCallback(
    (product) => {
      if (isComingSoon(product) || isComingSoon(products.find((p) => p.id === product.id))) return;
      haptic('medium');
      setCart((prev) => {
        const existing = prev.find((i) => i.id === product.id);
        if (existing) {
          return prev.map((i) =>
            i.id === product.id ? { ...i, qty: i.qty + 1 } : i
          );
        }
        return [
          ...prev,
          {
            id: product.id,
            name: product.name,
            price: product.price,
            sku: product.sku,
            thumbnail_url: product.thumbnail_url,
            qty: 1,
          },
        ];
      });
    },
    [haptic, products]
  );

  const updateQty = useCallback(
    (productId, delta) => {
      if (delta > 0 && isComingSoon(products.find((p) => p.id === productId))) return;
      haptic('light');
      setCart((prev) =>
        prev
          .map((i) =>
            i.id === productId
              ? { ...i, qty: Math.max(0, i.qty + delta) }
              : i
          )
          .filter((i) => i.qty > 0)
      );
    },
    [haptic, products]
  );

  const handleOrderSuccess = useCallback((order) => {
    const currentLastName = String(order?.last_name || '').trim();
    const orderPhone = normalizePhoneInput(order?.phone);

    if (currentLastName && orderPhone && orderPhone === normalizePhoneInput(gateData.phone)) {
      const currentUser = { phone: gateData.phone, lastName: currentLastName };
      setGateData(currentUser);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
    }

    hapticNotification('success');
    setCart([]);
  }, [gateData.phone, hapticNotification]);

  const clearCart = useCallback(() => {
    haptic('medium');
    setCart([]);
    setCartOpen(false);
  }, [haptic]);

  // ─── Навігація ───────────────────────────────────────
  const openProduct = useCallback(
    (product) => {
      haptic('light');
      setSelectedProduct(product);
      window.scrollTo(0, 0);
      setPage('product');
    },
    [haptic]
  );

  const goBack = useCallback(() => {
    haptic('light');
    setPage('catalog');
    setSelectedProduct(null);
  }, [haptic]);

  const openAdmin = useCallback((section = 'details') => {
    haptic('light');
    setInitialAdminSection(section);
    setPage('admin');
  }, [haptic]);

  const closeAdmin = useCallback(() => {
    haptic('light');
    setPage('catalog');
    loadData({ keepCachedCatalog: true });
  }, [haptic, loadData]);

  // ─── Гейт ────────────────────────────────────────────
  const handleAuthorized = useCallback((data) => {
    const userData = {
      phone: normalizePhoneInput(data.phone),
      lastName: String(data.lastName || '').trim(),
    };

    hapticNotification('success');
    // A pending record lets the app re-check the same phone on the next
    // launch. Automatic entry still happens only after server approval.
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    setGateData(userData);
    setAuthorized(true);
  }, [hapticNotification]);

  const openCart = useCallback(() => {
    haptic('medium');
    setCartOpen(true);
  }, [haptic]);

  const handleLogout = useCallback(() => {
    haptic('light');
    localStorage.removeItem(USER_STORAGE_KEY);
    setAuthorized(false);
    setAccessChecked(true);
    setGateData({ phone: '', lastName: '' });
    setPage('catalog');
    setSelectedProduct(null);
    setCartOpen(false);
    setCart([]);
    setCatalogState(null);
  }, [haptic]);

  // ─── Рендер ──────────────────────────────────────────

  if (!accessChecked) {
    return <div className="gate-page" aria-busy="true" />;
  }

  if (!authorized) {
    return (
      <GatePage
        onAuthorized={handleAuthorized}
        tgUserId={user?.id}
      />
    );
  }

  return (
    <div className="app-shell">
      {page === 'catalog' && (
        <CatalogPage
          products={products}
          categories={categories}
          loading={loading}
          error={loadError}
          onProductClick={openProduct}
          onAddToCart={addToCart}
          cartCount={cartCount}
          cartTotal={cartTotal}
          onCartClick={openCart}
          onClearCart={clearCart}
          cartQtyByProductId={cartQtyByProductId}
          onUpdateQty={updateQty}
          isAdmin={isAdmin}
          onAdminClick={openAdmin}
          savedState={catalogState}
          onSaveState={setCatalogState}
          brandColors={brandColors}
          defaultBrandColor={defaultBrandColor}
          catalogTitle={catalogTitle}
          paymentDetails={paymentDetails}
          paymentIban={paymentIban}
          paymentCardColor={paymentCardColor}
          paymentTaxId={paymentTaxId}
          paymentExtraDetails={paymentExtraDetails}
          paymentCardVisibility={paymentCardVisibility}
          userName={gateData.lastName}
          onLogout={handleLogout}
        />
      )}

      {page === 'product' && selectedProduct && (
        <React.Suspense fallback={<div className="gate-page" aria-busy="true" />}>
          <ProductPage
            productId={selectedProduct.id}
            initialProduct={selectedProduct}
            onBack={goBack}
            onAddToCart={addToCart}
          />
        </React.Suspense>
      )}

      {page === 'admin' && isAdmin && (
        <React.Suspense fallback={<div className="gate-page" aria-busy="true" />}>
          <AdminPage
            onBack={closeAdmin}
            brandColors={brandColors}
            onBrandColorChange={setBrandColorForBrand}
            defaultBrandColor={DEFAULT_BRAND_COLOR}
            catalogTitle={catalogTitle}
            onCatalogTitleChange={setCatalogTitleSetting}
            defaultCatalogTitle={DEFAULT_CATALOG_TITLE}
            paymentDetails={paymentDetails}
            paymentIban={paymentIban}
            onPaymentDetailsChange={setPaymentDetailsSetting}
            onPaymentIbanChange={setPaymentIbanSetting}
            paymentCardColor={paymentCardColor}
            onPaymentCardColorChange={setPaymentCardColorSetting}
            paymentTaxId={paymentTaxId}
            paymentExtraDetails={paymentExtraDetails}
            paymentCardVisibility={paymentCardVisibility}
            onPaymentTaxIdChange={setPaymentTaxIdSetting}
            onPaymentExtraDetailsChange={setPaymentExtraDetailsSetting}
            onPaymentCardVisibilityChange={setPaymentCardVisibilitySetting}
            initialSection={initialAdminSection}
            adminPhones={adminPhones}
            onAdminPhonesChange={setAdminPhonesSetting}
            adminSectionOrder={adminSectionOrder}
            onAdminSectionOrderChange={setAdminSectionOrderSetting}
            currentAdminPhone={gateData.phone}
          />
        </React.Suspense>
      )}

      {cartOpen && (
        <React.Suspense fallback={null}>
          <CartDrawer
            open={cartOpen}
            onClose={() => setCartOpen(false)}
            cart={cart}
            onUpdateQty={updateQty}
            onClearCart={clearCart}
            total={cartTotal}
            phone={gateData.phone}
            lastName={gateData.lastName}
            tgUserId={user?.id}
            tgUsername={user?.username}
            onOrderSuccess={handleOrderSuccess}
          />
        </React.Suspense>
      )}
    </div>
  );
}
