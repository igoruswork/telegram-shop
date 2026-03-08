import React, { useState } from 'react';
import { createOrder } from '../lib/supabase';
import { useSingleTap } from '../lib/useSingleTap';

function formatPrice(price) {
  return Number(price).toLocaleString('uk-UA');
}

export function CartDrawer({
  open,
  onClose,
  cart,
  onUpdateQty,
  total,
  phone,
  lastName,
  tgUserId,
  tgUsername,
  onOrderSuccess,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const bindSingleTap = useSingleTap();

  if (!open) return null;

  const handleSubmit = async () => {
    if (submitting || cart.length === 0) return;

    setSubmitting(true);
    setError('');

    try {
      const order = await createOrder({
        tgUserId,
        tgUsername,
        phone,
        lastName,
        items: cart.map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.qty,
          price: Number(i.price),
          sku: i.sku || '',
        })),
        total,
      });

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onOrderSuccess();
        onClose();
      }, 2500);
    } catch (err) {
      setError(err.message || 'Помилка відправки. Спробуйте ще раз.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {success && (
        <div className="success-toast">
          ✅ Замовлення #{success ? '' : ''}надіслано! Менеджер зв'яжеться з вами.
        </div>
      )}

      <div className="cart-overlay" onClick={onClose} />

      <div className="cart-drawer">
        <div className="cart-drawer-handle" />

        <div className="cart-drawer-header">
          <div className="cart-drawer-title">Кошик</div>
          <button type="button" className="cart-drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="cart-drawer-body">
          {cart.length === 0 ? (
            <div className="cart-empty">
              <div className="cart-empty-icon">🛒</div>
              <div>Кошик порожній</div>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="cart-item">
                {item.thumbnail_url ? (
                  <img
                    className="cart-item-img"
                    src={item.thumbnail_url}
                    alt={item.name}
                  />
                ) : (
                  <div className="cart-item-img" style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
                  }}>📦</div>
                )}

                <div className="cart-item-info">
                  <div className="cart-item-name">{item.name}</div>
                  <div className="cart-item-price">{formatPrice(item.price)} ₴</div>
                </div>

                <div className="cart-item-controls">
                  <button
                    type="button"
                    className="cart-qty-btn"
                    {...bindSingleTap(() => onUpdateQty(item.id, -1), {
                      preventDefault: true,
                    })}
                  >−</button>
                  <span className="cart-qty-value">{item.qty}</span>
                  <button
                    type="button"
                    className="cart-qty-btn"
                    {...bindSingleTap(() => onUpdateQty(item.id, 1), {
                      preventDefault: true,
                    })}
                  >+</button>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="cart-drawer-footer">
            <div className="cart-total-row">
              <span className="cart-total-label">Разом:</span>
              <span className="cart-total-value">{formatPrice(total)} ₴</span>
            </div>

            {error && (
              <div style={{
                color: '#ef4444', fontSize: 13, fontWeight: 600,
                marginBottom: 8, textAlign: 'center',
              }}>{error}</div>
            )}

            <button
              type="button"
              className="cart-submit-btn"
              disabled={submitting}
              {...bindSingleTap(handleSubmit, {
                preventDefault: true,
              })}
            >
              {submitting ? 'Надсилання…' : 'Оформити замовлення'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
