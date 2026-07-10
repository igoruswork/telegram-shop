import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTelegram } from './lib/useTelegram';
import {
  fetchAppSettings,
  fetchProducts,
  fetchCategories,
  logAccess,
  saveAppSettings,
  subscribeToAppSettings,
  subscribeToProducts,
  supabaseConfigError,
} from './lib/supabase';
import { GatePage } from './pages/GatePage';
import { CatalogPage } from './pages/CatalogPage';
import { ProductPage } from './pages/ProductPage';
import { AdminPage } from './pages/AdminPage';
import { CartDrawer } from './components/CartDrawer';
import { isPhoneComplete, normalizePhoneInput } from './lib/phone';
import './styles.css';

const ADMIN_PHONE = '+380111111111';
const DEFAULT_ADMIN_PHONES = [ADMIN_PHONE];
const DEFAULT_CATALOG_TITLE = 'Каталог';
const DEFAULT_BRAND_COLOR = '#075985';
const BRAND_COLORS_STORAGE_KEY = 'telegram-shop-brand-colors';
const CATALOG_TITLE_STORAGE_KEY = 'telegram-shop-catalog-title';
const USER_STORAGE_KEY = 'telegram-shop-user';

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

function normalizeBrandColors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([brand, color]) => String(brand).trim() && isHexColor(color))
  );
}

function normalizeAppSettings(value) {
  const brandColors = normalizeBrandColors(value?.brandColors || value?.brand_colors || {});
  const adminPhones = normalizeAdminPhones(value?.adminPhones || value?.admin_phones || []);
  const rawTitle = value?.catalogTitle || value?.catalog_title || '';
  const catalogTitle = typeof rawTitle === 'string' && rawTitle.trim()
    ? rawTitle.trim()
    : DEFAULT_CATALOG_TITLE;

  return {
    brandColors,
    catalogTitle,
    adminPhones,
  };
}

export default function App() {
  const { user, haptic, hapticNotification } = useTelegram();
  const storedUser = loadStoredUser();
  const [catalogTitle, setCatalogTitle] = useState(() => {
    const stored = localStorage.getItem(CATALOG_TITLE_STORAGE_KEY)?.trim();
    return stored || DEFAULT_CATALOG_TITLE;
  });
  const [brandColors, setBrandColors] = useState(loadStoredBrandColors);
  const [adminPhones, setAdminPhones] = useState(DEFAULT_ADMIN_PHONES);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [remoteSettingsFound, setRemoteSettingsFound] = useState(false);
  const defaultBrandColor = brandColors.__default || DEFAULT_BRAND_COLOR;
  const saveSettingsTimeoutRef = useRef(null);
  const localSettingsMigrationRef = useRef(false);
  const restoredUserRef = useRef(storedUser);
  const restoredAccessLoggedRef = useRef(false);

  // ─── Авторизація (гейт) ──────────────────────────────
  const [authorized, setAuthorized] = useState(Boolean(storedUser));
  const [gateData, setGateData] = useState(storedUser || { phone: '', lastName: '' });
  const [forceManualGate, setForceManualGate] = useState(false);
  const isAdmin = adminPhones.includes(normalizePhoneInput(gateData.phone));

  // ─── Навігація ────────────────────────────────────────
  const [page, setPage] = useState('catalog'); // 'catalog' | 'product' | 'admin'
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [initialAdminSection, setInitialAdminSection] = useState('details');

  // ─── Збереження стану каталогу (скрол + категорія) ───
  const [catalogState, setCatalogState] = useState(null);

  // ─── Дані з Supabase ─────────────────────────────────
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(supabaseConfigError);

  // ─── Кошик (тимчасовий, в пам'яті) ──────────────────
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    const setViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
    };

    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    window.visualViewport?.addEventListener('resize', setViewportHeight);

    return () => {
      window.removeEventListener('resize', setViewportHeight);
      window.visualViewport?.removeEventListener('resize', setViewportHeight);
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
    if (
      !authorized ||
      !restoredUserRef.current ||
      restoredAccessLoggedRef.current ||
      !gateData.phone ||
      !gateData.lastName
    ) {
      return;
    }

    restoredAccessLoggedRef.current = true;
    logAccess({
      phone: gateData.phone,
      lastName: gateData.lastName,
      tgUserId: user?.id,
    }).catch((error) => {
      console.warn('remembered access log error:', error);
    });
  }, [authorized, gateData.lastName, gateData.phone, user?.id]);

  const applyRemoteSettings = useCallback((settings) => {
    if (!settings || typeof settings !== 'object') return false;

    const normalized = normalizeAppSettings(settings);
    setBrandColors(normalized.brandColors);
    setCatalogTitle(normalized.catalogTitle);
    setAdminPhones(normalized.adminPhones);
    return true;
  }, []);

  const queueSaveSettings = useCallback((settings) => {
    const normalized = normalizeAppSettings(settings);

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
    });
  }, [adminPhones, brandColors, catalogTitle, queueSaveSettings]);

  const setCatalogTitleSetting = useCallback((value) => {
    const nextCatalogTitle = String(value || '').trim() || DEFAULT_CATALOG_TITLE;

    setCatalogTitle(nextCatalogTitle);
    queueSaveSettings({
      brandColors,
      catalogTitle: nextCatalogTitle,
      adminPhones,
    });
  }, [adminPhones, brandColors, queueSaveSettings]);

  const setAdminPhonesSetting = useCallback((phones) => {
    const nextAdminPhones = normalizeAdminPhones(phones);

    setAdminPhones(nextAdminPhones);
    queueSaveSettings({
      brandColors,
      catalogTitle,
      adminPhones: nextAdminPhones,
    });
  }, [brandColors, catalogTitle, queueSaveSettings]);

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
    });
  }, [adminPhones, authorized, brandColors, catalogTitle, isAdmin, queueSaveSettings, remoteSettingsFound, settingsLoaded]);

  // ─── Завантаження даних з Supabase ───────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    try {
      const [productsData, categoriesData] = await Promise.all([
        fetchProducts(),
        fetchCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (error) {
      setProducts([]);
      setCategories([]);
      setLoadError(error.message || 'Не вдалося завантажити дані.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Після авторизації: завантажити + підписатися на Realtime
  useEffect(() => {
    if (!authorized) return;

    loadData();

    const unsubscribe = subscribeToProducts(() => {
      loadData();
    });

    return unsubscribe;
  }, [authorized, loadData]);

  // ─── Кошик ───────────────────────────────────────────
  const addToCart = useCallback(
    (product) => {
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
    [haptic]
  );

  const updateQty = useCallback(
    (productId, delta) => {
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
    [haptic]
  );

  const cartTotal = cart.reduce((sum, i) => sum + Number(i.price) * i.qty, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  const handleOrderSuccess = useCallback(() => {
    hapticNotification('success');
    setCart([]);
  }, [hapticNotification]);

  // ─── Навігація ───────────────────────────────────────
  const openProduct = useCallback(
    (product) => {
      haptic('light');
      setSelectedProductId(product.id);
      setPage('product');
    },
    [haptic]
  );

  const goBack = useCallback(() => {
    haptic('light');
    setPage('catalog');
    setSelectedProductId(null);
  }, [haptic]);

  const openAdmin = useCallback((section = 'details') => {
    haptic('light');
    setInitialAdminSection(section);
    setPage('admin');
  }, [haptic]);

  const closeAdmin = useCallback(() => {
    haptic('light');
    setPage('catalog');
  }, [haptic]);

  // ─── Гейт ────────────────────────────────────────────
  const handleAuthorized = useCallback((data) => {
    const userData = {
      phone: normalizePhoneInput(data.phone),
      lastName: String(data.lastName || '').trim(),
    };

    hapticNotification('success');
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    setGateData(userData);
    setAuthorized(true);
    setForceManualGate(false);
  }, [hapticNotification]);

  const handleLogout = useCallback(() => {
    haptic('light');
    localStorage.removeItem(USER_STORAGE_KEY);
    setAuthorized(false);
    setGateData({ phone: '', lastName: '' });
    setForceManualGate(true);
    setPage('catalog');
    setSelectedProductId(null);
    setCartOpen(false);
    setCart([]);
    setCatalogState(null);
  }, [haptic]);

  // ─── Рендер ──────────────────────────────────────────

  if (!authorized) {
    return (
      <GatePage
        onAuthorized={handleAuthorized}
        tgUserId={user?.id}
        autoAuthorizeKnownUser={!forceManualGate}
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
          onCartClick={() => {
            haptic('medium');
            setCartOpen(true);
          }}
          cart={cart}
          onUpdateQty={updateQty}
          isAdmin={isAdmin}
          onAdminClick={openAdmin}
          savedState={catalogState}
          onSaveState={setCatalogState}
          brandColors={brandColors}
          defaultBrandColor={defaultBrandColor}
          catalogTitle={catalogTitle}
          userName={gateData.lastName}
          onLogout={handleLogout}
        />
      )}

      {page === 'product' && selectedProductId && (
        <ProductPage
          productId={selectedProductId}
          onBack={goBack}
          onAddToCart={addToCart}
        />
      )}

      {page === 'admin' && (
        <AdminPage
          onBack={closeAdmin}
          brandColors={brandColors}
          onBrandColorChange={setBrandColorForBrand}
          defaultBrandColor={DEFAULT_BRAND_COLOR}
          catalogTitle={catalogTitle}
          onCatalogTitleChange={setCatalogTitleSetting}
          defaultCatalogTitle={DEFAULT_CATALOG_TITLE}
          initialSection={initialAdminSection}
          adminPhones={adminPhones}
          onAdminPhonesChange={setAdminPhonesSetting}
          currentAdminPhone={gateData.phone}
        />
      )}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        onUpdateQty={updateQty}
        total={cartTotal}
        phone={gateData.phone}
        lastName={gateData.lastName}
        tgUserId={user?.id}
        tgUsername={user?.username}
        onOrderSuccess={handleOrderSuccess}
      />
    </div>
  );
}
