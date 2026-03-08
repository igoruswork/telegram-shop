import React, { useState, useEffect, useCallback } from 'react';
import { useTelegram } from './lib/useTelegram';
import {
  fetchProducts,
  fetchCategories,
  subscribeToProducts,
  supabaseConfigError,
} from './lib/supabase';
import { GatePage } from './pages/GatePage';
import { CatalogPage } from './pages/CatalogPage';
import { ProductPage } from './pages/ProductPage';
import { CartDrawer } from './components/CartDrawer';
import './styles.css';

export default function App() {
  const { user, haptic, hapticNotification } = useTelegram();

  // ─── Авторизація (гейт) ──────────────────────────────
  const [authorized, setAuthorized] = useState(false);
  const [gateData, setGateData] = useState({ phone: '', lastName: '' });

  // ─── Навігація ────────────────────────────────────────
  const [page, setPage] = useState('catalog'); // 'catalog' | 'product'
  const [selectedProductId, setSelectedProductId] = useState(null);

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

    // Перше завантаження
    loadData();

    // Realtime підписка — при будь-якій зміні в products
    // автоматично перезавантажує дані з Supabase
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

  // ─── Гейт ────────────────────────────────────────────
  const handleAuthorized = useCallback((data) => {
    hapticNotification('success');
    setGateData(data);
    setAuthorized(true);
  }, [hapticNotification]);

  // ─── Рендер ──────────────────────────────────────────

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
          onCartClick={() => {
            haptic('medium');
            setCartOpen(true);
          }}
          cart={cart}
          onUpdateQty={updateQty}
        />
      )}

      {page === 'product' && selectedProductId && (
        <ProductPage
          productId={selectedProductId}
          onBack={goBack}
          onAddToCart={addToCart}
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
